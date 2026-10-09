/**
 * XPERTIAL — Firebase Cloud Functions
 * ─────────────────────────────────────────────────────────────────
 * All server-side logic lives here:
 *   • Razorpay order creation + payment verification
 *   • Resend transactional emails
 *   • Firebase Storage signed download URLs
 *   • Firestore triggers (auto-notifications, invoice generation)
 *
 * SETUP:
 *   firebase functions:secrets:set RAZORPAY_KEY_ID
 *   firebase functions:secrets:set RAZORPAY_KEY_SECRET
 *   firebase functions:secrets:set RESEND_API_KEY
 *
 * DEPLOY:
 *   firebase deploy --only functions
 * ─────────────────────────────────────────────────────────────────
 */

const functions  = require("firebase-functions");
const admin      = require("firebase-admin");
const Razorpay   = require("razorpay");
const { Resend } = require("resend");
const crypto     = require("crypto");

admin.initializeApp();
const db      = admin.firestore();
const storage = admin.storage();

/* ── Lazy-init authenticated clients (uses Secret Manager) ── */
function getRazorpay() {
  return new Razorpay({
    key_id:     process.env.RAZORPAY_KEY_ID,
    key_secret: process.env.RAZORPAY_KEY_SECRET,
  });
}
function getResend() {
  return new Resend(process.env.RESEND_API_KEY);
}

/* ── CORS helper for callable-style HTTPS functions ── */
function cors(req, res, next) {
  res.set("Access-Control-Allow-Origin",  "*");
  res.set("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.set("Access-Control-Allow-Headers", "Content-Type, Authorization");
  if (req.method === "OPTIONS") { res.status(204).send(""); return; }
  next();
}

/* ── Auth middleware ── */
async function authenticate(req, res) {
  const auth = req.headers.authorization;
  if (!auth?.startsWith("Bearer ")) { res.status(401).json({ error: "Unauthorized" }); return null; }
  try {
    const decoded = await admin.auth().verifyIdToken(auth.split("Bearer ")[1]);
    return decoded;
  } catch {
    res.status(401).json({ error: "Invalid token" });
    return null;
  }
}

/* ═══════════════════════════════════════════════════
   1. CREATE RAZORPAY ORDER
   Called by client panel when paying deposit or final
   ═══════════════════════════════════════════════════ */
exports.createRazorpayOrder = functions
  .runWith({ secrets: ["RAZORPAY_KEY_ID", "RAZORPAY_KEY_SECRET"] })
  .https.onRequest(async (req, res) => {
    cors(req, res, async () => {
      const user = await authenticate(req, res);
      if (!user) return;

      const { projectId, amount, type } = req.body;
      if (!projectId || !amount || !type) {
        return res.status(400).json({ error: "projectId, amount and type are required" });
      }

      // Verify project belongs to this user
      const projRef  = db.collection("projects").doc(projectId);
      const projSnap = await projRef.get();
      if (!projSnap.exists || projSnap.data().clientId !== user.uid) {
        return res.status(403).json({ error: "Project not found or access denied" });
      }

      try {
        const razorpay = getRazorpay();
        const order = await razorpay.orders.create({
          amount,          // in paise
          currency: "INR",
          receipt: `xp_${projectId}_${type}_${Date.now()}`,
          notes: { projectId, type, clientId: user.uid }
        });
        return res.json({ orderId: order.id });
      } catch (err) {
        console.error("Razorpay order error:", err);
        return res.status(500).json({ error: "Failed to create payment order" });
      }
    });
  });

/* ═══════════════════════════════════════════════════
   2. VERIFY RAZORPAY PAYMENT
   Validates signature, updates Firestore, sends email
   ═══════════════════════════════════════════════════ */
exports.verifyRazorpayPayment = functions
  .runWith({ secrets: ["RAZORPAY_KEY_ID", "RAZORPAY_KEY_SECRET", "RESEND_API_KEY"] })
  .https.onRequest(async (req, res) => {
    cors(req, res, async () => {
      const user = await authenticate(req, res);
      if (!user) return;

      const { razorpay_order_id, razorpay_payment_id, razorpay_signature, projectId, type } = req.body;

      // Verify Razorpay signature
      const body     = razorpay_order_id + "|" + razorpay_payment_id;
      const expected = crypto.createHmac("sha256", process.env.RAZORPAY_KEY_SECRET)
        .update(body).digest("hex");
      if (expected !== razorpay_signature) {
        return res.status(400).json({ error: "Invalid payment signature" });
      }

      const projRef  = db.collection("projects").doc(projectId);
      const projSnap = await projRef.get();
      if (!projSnap.exists) return res.status(404).json({ error: "Project not found" });
      const project = projSnap.data();

      const amount   = project.quoteAmount / 2;
      const now      = admin.firestore.FieldValue.serverTimestamp();
      const paymentId = `PAY-${Date.now().toString(36).toUpperCase()}`;

      const batch = db.batch();

      // Record payment
      const payRef = db.collection("payments").doc();
      batch.set(payRef, {
        id: paymentId, projectId, projectName: project.name || "Data Project",
        clientId: user.uid, type, amount,
        razorpayOrderId: razorpay_order_id, razorpayPaymentId: razorpay_payment_id,
        status: "paid", createdAt: now
      });

      // Update project
      const projUpdate = type === "deposit"
        ? { depositPaid: true, depositPaymentId: paymentId, depositPaidAt: now,
            activity: admin.firestore.FieldValue.arrayUnion({ message: "50% deposit payment received", at: new Date() }) }
        : { finalPaid: true, finalPaymentId: paymentId, finalPaidAt: now,
            activity: admin.firestore.FieldValue.arrayUnion({ message: "Final payment received — dataset unlocked", at: new Date() }) };
      batch.update(projRef, projUpdate);

      // Notification
      const notifRef = db.collection("notifications").doc();
      batch.set(notifRef, {
        userId: user.uid, type: "success", read: false,
        title: "Payment Confirmed",
        message: `${type === "deposit" ? "50% deposit" : "Final payment"} of ₹${amount.toLocaleString("en-IN")} received for ${project.name || "your project"}.`,
        actionUrl: `/client/project.html?id=${projectId}`,
        createdAt: now
      });

      // Invoice
      const invoiceRef = db.collection("invoices").doc();
      batch.set(invoiceRef, {
        invoiceNumber: `INV-${Date.now().toString(36).toUpperCase()}`,
        projectId, projectName: project.name || "Data Project",
        clientId: user.uid, type, amount, paid: true, createdAt: now
      });

      await batch.commit();

      // Send confirmation email via Resend
      try {
        const userSnap = await db.collection("users").doc(user.uid).get();
        const clientEmail = userSnap.data()?.email || user.email;
        const clientName  = userSnap.data()?.name  || "Valued Client";
        await sendPaymentConfirmationEmail(clientEmail, clientName, project.name, amount, type, paymentId);
      } catch (emailErr) {
        console.warn("Email send failed (non-fatal):", emailErr.message);
      }

      return res.json({ success: true, paymentId });
    });
  });

/* ═══════════════════════════════════════════════════
   3. GENERATE SIGNED DOWNLOAD URL
   Creates a time-limited (1 hour) S3/GCS signed URL
   ═══════════════════════════════════════════════════ */
exports.generateDownloadUrl = functions.https.onRequest(async (req, res) => {
  cors(req, res, async () => {
    const user = await authenticate(req, res);
    if (!user) return;

    const { path } = req.body;
    if (!path) return res.status(400).json({ error: "path required" });

    // Verify client has paid for this dataset
    const snap = await db.collection("projects")
      .where("clientId", "==", user.uid).where("datasetUrl", "==", path)
      .where("finalPaid", "==", true).limit(1).get();
    if (snap.empty) return res.status(403).json({ error: "Dataset not available or payment pending" });

    try {
      const bucket = storage.bucket();
      const file   = bucket.file(path);
      const [url]  = await file.getSignedUrl({ action: "read", expires: Date.now() + 3600000 }); // 1 hour
      return res.json({ url });
    } catch (err) {
      console.error("Signed URL error:", err);
      return res.status(500).json({ error: "Failed to generate download URL" });
    }
  });
});

/* ═══════════════════════════════════════════════════
   4. FIRESTORE TRIGGERS — Auto notifications + emails
   ═══════════════════════════════════════════════════ */

/* When admin updates project status → notify client */
exports.onProjectStatusChange = functions.firestore
  .document("projects/{projectId}")
  .onUpdate(async (change, context) => {
    const before = change.before.data();
    const after  = change.after.data();
    if (before.status === after.status) return null;

    const { projectId } = context.params;
    const clientId = after.clientId;
    if (!clientId) return null;

    const statusMessages = {
      quoted:     { title: "Quote Ready!",        msg: "Your project quote is ready. Review and pay 50% deposit to proceed.", type: "info" },
      contracted: { title: "Project Activated",   msg: "MSA signed and project activated. Data collection begins soon.",     type: "success" },
      collecting: { title: "Collection Started",  msg: "Our collectors have started gathering your data.",                   type: "info" },
      qc:         { title: "Quality Review",      msg: "Data collection complete. Your dataset is under quality review.",    type: "info" },
      completed:  { title: "Dataset Ready! 🎉",   msg: "Your dataset has passed QC and is ready. Pay the final 50% to download.", type: "success" },
      rejected:   { title: "Update Required",     msg: "Your request needs updates. Please check the project for details.",  type: "warning" },
    };

    const info = statusMessages[after.status];
    if (!info) return null;

    const now = admin.firestore.FieldValue.serverTimestamp();
    await db.collection("notifications").add({
      userId: clientId, type: info.type, read: false,
      title: info.title, message: info.msg,
      actionUrl: `/client/project.html?id=${projectId}`,
      createdAt: now
    });

    // Send email notification
    try {
      const userSnap = await db.collection("users").doc(clientId).get();
      if (userSnap.exists) {
        const { email, name } = userSnap.data();
        await sendStatusUpdateEmail(email, name, after.name || "your project", after.status, projectId);
      }
    } catch (err) {
      console.warn("Status email failed:", err.message);
    }

    return null;
  });

/* When a new request comes in → notify admins */
exports.onNewRequest = functions.firestore
  .document("requests/{requestId}")
  .onCreate(async (snap, context) => {
    const req = snap.data();
    try {
      // Notify all admins
      const admins = await db.collection("users").where("role", "==", "admin").get();
      const batch  = db.batch();
      admins.docs.forEach(adminDoc => {
        const notifRef = db.collection("notifications").doc();
        batch.set(notifRef, {
          userId: adminDoc.id, type: "info", read: false,
          title: "New Data Request",
          message: `${req.contact?.firstName || "A client"} submitted a new ${req.dataType || "data"} collection request (${req.id}).`,
          actionUrl: `/admin/request.html?id=${snap.id}`,
          createdAt: admin.firestore.FieldValue.serverTimestamp()
        });
      });
      await batch.commit();

      // Email admin team
      await sendNewRequestEmail(req);
    } catch (err) {
      console.warn("New request notification failed:", err.message);
    }
    return null;
  });

/* ═══════════════════════════════════════════════════
   5. EMAIL TEMPLATES (Resend)
   ═══════════════════════════════════════════════════ */

const EMAIL_FROM     = "XPERTIAL <noreply@xpertial.com>";     // ← update to your verified domain
const ADMIN_EMAIL    = "admin@xpertial.com";                  // ← your admin email
const BRAND_COLOR    = "#00D4FF";
const emailBase      = (content) => `
<!DOCTYPE html><html><head><meta charset="UTF-8"/><meta name="viewport" content="width=device-width,initial-scale=1.0"/>
<style>body{margin:0;padding:0;background:#0A0D14;font-family:'Inter',system-ui,sans-serif;color:#E8EDF5;}
.wrap{max-width:560px;margin:0 auto;padding:40px 20px;}
.logo{text-align:center;margin-bottom:32px;font-family:'Rajdhani',sans-serif;font-size:22px;font-weight:700;letter-spacing:.15em;color:${BRAND_COLOR};}
.card{background:#0F1420;border:1px solid rgba(0,212,255,.15);border-radius:12px;padding:32px;margin-bottom:24px;}
.card::before{display:block;content:'';height:2px;background:linear-gradient(90deg,transparent,${BRAND_COLOR},transparent);margin:-32px -32px 28px;border-radius:12px 12px 0 0;}
h2{font-size:20px;font-weight:700;margin:0 0 8px;color:#fff;}
p{color:#9CA3AF;font-size:14px;line-height:1.7;margin:0 0 16px;}
.btn{display:inline-block;background:${BRAND_COLOR};color:#000;text-decoration:none;padding:12px 28px;border-radius:7px;font-weight:700;font-size:14px;letter-spacing:.05em;}
.detail{background:#1A1F2E;border-radius:8px;padding:16px;margin:16px 0;}
.detail-row{display:flex;justify-content:space-between;padding:6px 0;border-bottom:1px solid rgba(255,255,255,.05);font-size:13px;}
.detail-row:last-child{border-bottom:none;}
.label{color:#6B7280;}.value{color:#E8EDF5;font-weight:600;}
.footer{text-align:center;color:#4B5563;font-size:12px;margin-top:24px;}
</style></head><body><div class="wrap"><div class="logo">XPERTIAL</div>${content}
<div class="footer">© 2026 XPERTIAL Technologies Pvt. Ltd. · <a href="https://xpertial.com/company/privacy.html" style="color:#4B5563;">Privacy</a></div>
</div></body></html>`;

async function sendPaymentConfirmationEmail(to, name, projectName, amount, type, paymentId) {
  const resend = getResend();
  const label  = type === "deposit" ? "50% Deposit" : "Final Payment";
  await resend.emails.send({
    from: EMAIL_FROM, to,
    subject: `Payment Confirmed — ${xpFmt(amount)} ${label} · XPERTIAL`,
    html: emailBase(`
      <div class="card">
        <h2>✅ Payment Confirmed</h2>
        <p>Hi ${name}, your ${label.toLowerCase()} payment has been received and verified.</p>
        <div class="detail">
          <div class="detail-row"><span class="label">Project</span><span class="value">${projectName}</span></div>
          <div class="detail-row"><span class="label">Payment Type</span><span class="value">${label}</span></div>
          <div class="detail-row"><span class="label">Amount Paid</span><span class="value">₹${Number(amount).toLocaleString("en-IN")}</span></div>
          <div class="detail-row"><span class="label">Payment ID</span><span class="value">${paymentId}</span></div>
        </div>
        ${type === "deposit"
          ? "<p>Our team will review the agreement and begin the collection process shortly.</p>"
          : "<p>Your dataset is now unlocked. Log in to your dashboard to download it.</p>"}
        <a href="https://xpertial.com/client/index.html" class="btn">Go to Dashboard →</a>
      </div>`)
  });
}

async function sendStatusUpdateEmail(to, name, projectName, status, projectId) {
  const resend = getResend();
  const subjects = {
    quoted:     "Your Quote is Ready — XPERTIAL",
    contracted: "Project Activated — XPERTIAL",
    collecting: "Data Collection Started — XPERTIAL",
    qc:         "Quality Review in Progress — XPERTIAL",
    completed:  "Dataset Ready for Download — XPERTIAL 🎉",
    rejected:   "Project Update Required — XPERTIAL",
  };
  const bodies = {
    quoted:     `<p>Hi ${name}, your quote for <strong>${projectName}</strong> is ready. Review and pay the 50% deposit to get started.</p>`,
    contracted: `<p>Hi ${name}, your project <strong>${projectName}</strong> has been activated. Our collectors will begin work shortly.</p>`,
    collecting: `<p>Hi ${name}, data collection has started for <strong>${projectName}</strong>. You'll receive updates as we progress.</p>`,
    qc:         `<p>Hi ${name}, collection is complete for <strong>${projectName}</strong> and your dataset is now in quality review.</p>`,
    completed:  `<p>Hi ${name}, 🎉 your dataset for <strong>${projectName}</strong> has passed QC and is ready. Pay the final 50% to download it now.</p>`,
    rejected:   `<p>Hi ${name}, your project <strong>${projectName}</strong> needs updates before we can proceed. Please check the project page.</p>`,
  };
  if (!subjects[status]) return;
  await resend.emails.send({
    from: EMAIL_FROM, to,
    subject: subjects[status],
    html: emailBase(`
      <div class="card">
        <h2>${subjects[status].split(" — ")[0]}</h2>
        ${bodies[status]}
        <a href="https://xpertial.com/client/project.html?id=${projectId}" class="btn">View Project →</a>
      </div>`)
  });
}

async function sendNewRequestEmail(req) {
  const resend = getResend();
  await resend.emails.send({
    from: EMAIL_FROM, to: ADMIN_EMAIL,
    subject: `New Request ${req.id} — ${req.dataType || "Custom"} Collection`,
    html: emailBase(`
      <div class="card">
        <h2>📋 New Data Collection Request</h2>
        <div class="detail">
          <div class="detail-row"><span class="label">Request ID</span><span class="value">${req.id}</span></div>
          <div class="detail-row"><span class="label">Data Type</span><span class="value">${req.dataType||"—"}</span></div>
          <div class="detail-row"><span class="label">Volume</span><span class="value">${req.volume?Number(req.volume).toLocaleString()+" samples":"—"}</span></div>
          <div class="detail-row"><span class="label">Location</span><span class="value">${req.location||"—"}</span></div>
          <div class="detail-row"><span class="label">Budget</span><span class="value">${req.budget||"—"}</span></div>
          <div class="detail-row"><span class="label">Timeline</span><span class="value">${req.timeline||"—"}</span></div>
          <div class="detail-row"><span class="label">Client</span><span class="value">${req.contact?.firstName||""} ${req.contact?.lastName||""}</span></div>
          <div class="detail-row"><span class="label">Email</span><span class="value">${req.clientEmail||"—"}</span></div>
        </div>
        <a href="https://admin.xpertial.com/request.html?id=${req.firestoreId}" class="btn">Review in Admin Panel →</a>
      </div>`)
  });
}

/* Helper for email formatting */
function xpFmt(n) { return "₹" + Number(n).toLocaleString("en-IN"); }
