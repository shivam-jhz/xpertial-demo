# XPERTIAL — Firebase Setup Guide

## What's in this folder

```
xpertial-firebase/
├── index.html              ← Marketing homepage
├── request.html            ← Data request form (Firestore)
├── login.html              ← Firebase Auth (email + Google + GitHub)
├── services.html / pricing.html / etc.
├── client/
│   ├── index.html          ← Dashboard (live Firestore)
│   ├── projects.html       ← Projects list
│   ├── project.html        ← Project detail + Razorpay payments
│   ├── payments.html       ← Payment history
│   ├── downloads.html      ← Dataset downloads
│   ├── contracts.html      ← MSA contracts
│   ├── invoices.html       ← Invoices
│   ├── notifications.html  ← Real-time notifications
│   └── settings.html       ← Profile + password
├── assets/
│   ├── xpertial.js         ← Firebase init + all shared helpers
│   └── xpertial.css
├── functions/
│   ├── index.js            ← Cloud Functions (Razorpay, Resend, Storage)
│   └── package.json
├── firebase.json           ← Hosting + Functions config
├── firestore.rules         ← Security rules
├── firestore.indexes.json  ← Composite indexes
└── storage.rules           ← Storage security rules
```

---

## Step 1 — Create Firebase Project

1. Go to https://console.firebase.google.com
2. Click **Add project** → name it `xpertial` → disable Google Analytics (optional) → Create
3. Go to **Project Settings** (gear icon)
4. Scroll to **Your apps** → click **</>** (Web) → register app as `xpertial-web`
5. Copy the `firebaseConfig` object

---

## Step 2 — Paste Firebase Config

Open `assets/xpertial.js` and paste your config into `FIREBASE_CONFIG`:

```js
const FIREBASE_CONFIG = {
  apiKey:            "AIzaSy...",
  authDomain:        "xpertial-xxxxx.firebaseapp.com",
  projectId:         "xpertial-xxxxx",
  storageBucket:     "xpertial-xxxxx.appspot.com",
  messagingSenderId: "123456789",
  appId:             "1:123456789:web:abc123"
};
```

Also update `FUNCTIONS_URL`:
```js
window.FUNCTIONS_URL = "https://us-central1-xpertial-xxxxx.cloudfunctions.net";
```

---

## Step 3 — Enable Firebase Services

In the Firebase Console:

### Authentication
- Go to **Authentication** → **Sign-in method**
- Enable: **Email/Password**, **Google**, **GitHub**
- For GitHub: create a GitHub OAuth app at https://github.com/settings/developers
  - Homepage URL: `https://xpertial-xxxxx.web.app`
  - Callback URL: copy from Firebase (shown when you enable GitHub)

### Firestore Database
- Go to **Firestore Database** → **Create database**
- Start in **production mode** → choose region (e.g. `asia-south1` for India)

### Storage
- Go to **Storage** → **Get started** → Production mode → same region as Firestore

---

## Step 4 — Install Firebase CLI

```bash
npm install -g firebase-tools
firebase login
firebase use --add    # select your project → alias: default
```

---

## Step 5 — Deploy Security Rules & Indexes

```bash
firebase deploy --only firestore:rules,firestore:indexes,storage
```

---

## Step 6 — Set Up Cloud Functions

### Upgrade to Blaze plan (required for external API calls)
Firebase Console → Settings → Usage and billing → **Modify plan** → Blaze (pay-as-you-go)
> Your free tier usage is still free. You just need a card on file.

### Get your API keys

**Razorpay:** https://dashboard.razorpay.com → Settings → API Keys → Generate Key
- Copy `Key ID` and `Key Secret`

**Resend:** https://resend.com → API Keys → Create API Key
- Verify your domain (add DNS records) for production
- For testing you can send to your own email without a domain

### Store secrets in Firebase (never in code)
```bash
firebase functions:secrets:set RAZORPAY_KEY_ID
# (paste your Razorpay Key ID, press Enter)

firebase functions:secrets:set RAZORPAY_KEY_SECRET
# (paste your Razorpay Key Secret)

firebase functions:secrets:set RESEND_API_KEY
# (paste your Resend API Key)
```

### Update email addresses in functions/index.js
```js
const EMAIL_FROM  = "XPERTIAL <noreply@yourdomain.com>";  // verified Resend domain
const ADMIN_EMAIL = "admin@yourdomain.com";
```

### Deploy Functions
```bash
cd functions
npm install
cd ..
firebase deploy --only functions
```

---

## Step 7 — Update Razorpay Key in Frontend

In `assets/xpertial.js`:
```js
window.RAZORPAY_KEY = "rzp_live_XXXXXXXXXXXXXXXX"; // your live key
```

---

## Step 8 — Deploy Website

```bash
firebase deploy --only hosting
```

Your site is live at:
- `https://xpertial-xxxxx.web.app`
- `https://xpertial-xxxxx.firebaseapp.com`

For a custom domain (e.g. xpertial.com): Firebase Console → Hosting → Add custom domain

---

## Step 9 — Create First Admin Account

1. Go to your live site → login.html → register with your email
2. In Firebase Console → Firestore → users collection → find your document
3. Add field: `role` = `"admin"` (string)

From now on the admin panel (coming next) will recognise you as admin.

---

## Step 10 — Test the Full Flow

1. Open site → Register a client account → verify email
2. Go to Request page → submit a request → check Firestore `requests` collection
3. In Firestore Console, manually create a `projects` document linked to the request
4. Check client dashboard → see the project → try Razorpay test payment
   - Test card: `4111 1111 1111 1111`, any future date, any CVV

---

## Local Development (optional)

```bash
firebase emulators:start
```
Opens at http://localhost:5000 with full local Firebase stack (Auth, Firestore, Storage, Functions).

---

## Collections Reference

| Collection       | Purpose                          |
|------------------|----------------------------------|
| `users`          | Auth profiles + roles            |
| `requests`       | Raw form submissions             |
| `projects`       | Active/completed projects        |
| `payments`       | Razorpay payment records         |
| `invoices`       | Invoice metadata + PDF links     |
| `contracts`      | Signed MSA records               |
| `downloads`      | Dataset access records           |
| `notifications`  | Real-time user notifications     |
| `tasks`          | Collector assignments            |
| `submissions`    | Individual collector uploads     |
| `payoutRequests` | Collector payout requests        |

---

## What's Next

- **Admin Panel** — full company management dashboard
- **Collector App** — React Native (Expo) app for iOS + Android
