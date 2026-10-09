# XPERTIAL — Website + Client Panel
## AWS Setup & Deployment Guide

---

## What's Included

```
xpertial/
├── index.html              ← Main landing page
├── login.html              ← Login & Register (AWS Cognito)
├── request.html            ← Multi-step data request form
├── services.html           ← Services page
├── how-it-works.html       ← How it works page
├── pricing.html            ← Pricing page
├── assets/
│   ├── xpertial.css        ← Shared design system CSS
│   ├── xpertial.js         ← Shared JS + AWS config template
│   └── favicon.svg
├── client/
│   ├── index.html          ← Client dashboard
│   ├── projects.html       ← Projects list
│   ├── project.html        ← Project detail + timeline + payments
│   ├── downloads.html      ← Dataset downloads (S3)
│   ├── payments.html       ← Payment history
│   └── settings.html       ← Account settings
└── company/
    ├── about.html
    ├── contact.html
    ├── terms.html
    └── privacy.html
```

---

## Step 1: AWS Setup (One-Time)

### 1A. Create AWS Account
Go to https://aws.amazon.com and create an account.
Use region: **ap-south-1** (Mumbai) for India.

### 1B. Create S3 Bucket
1. Go to S3 → Create Bucket
2. Name: `xpertial-datasets`
3. Region: `ap-south-1`
4. Block all public access: **ON**
5. Enable versioning: **ON**
6. Go to CORS settings and add:
```json
[
  {
    "AllowedHeaders": ["*"],
    "AllowedMethods": ["GET", "PUT", "POST"],
    "AllowedOrigins": ["https://yourdomain.com"],
    "ExposeHeaders": []
  }
]
```

### 1C. Create DynamoDB Tables
Go to DynamoDB → Create Table for each:

**Table 1: xpertial-projects**
- Partition key: `id` (String)
- Add GSI: `clientEmail-index` on `clientEmail` (String)

**Table 2: xpertial-requests**
- Partition key: `id` (String)
- Add GSI: `clientEmail-index` on `clientEmail` (String)

**Table 3: xpertial-payments**
- Partition key: `id` (String)
- Add GSI: `projectId-index` on `projectId` (String)

**Table 4: xpertial-users**
- Partition key: `email` (String)

### 1D. Create Cognito User Pool
1. Go to Cognito → Create User Pool
2. Sign-in options: **Email**
3. Password policy: Min 8 chars, 1 uppercase, 1 number
4. Self-service sign-up: **Enabled**
5. Required attributes: `email`, `name`
6. Custom attributes: `custom:company`, `custom:phone`
7. Email provider: Cognito (or SES for production)
8. Create App Client:
   - Name: `xpertial-web`
   - Auth flows: ALLOW_USER_SRP_AUTH, ALLOW_REFRESH_TOKEN_AUTH
   - No client secret
9. Note down: **User Pool ID** and **App Client ID**

### 1E. Create Cognito Identity Pool (for S3 access)
1. Go to Cognito → Identity Pools → Create
2. Link to your User Pool
3. Set IAM role permissions to allow S3 GetObject for `xpertial-datasets`
4. Note down the **Identity Pool ID**

---

## Step 2: Update Config

Open `assets/xpertial.js` and replace the placeholder values:

```javascript
window.XPERTIAL_AWS = {
  region: 'ap-south-1',
  userPoolId: 'ap-south-1_YOUR_POOL_ID',       // From Cognito
  userPoolClientId: 'YOUR_CLIENT_ID',            // App Client ID
  identityPoolId: 'ap-south-1:YOUR-IDENTITY-POOL-ID',
  s3Bucket: 'xpertial-datasets',
  dynamoTable: 'xpertial-projects',
  razorpayKey: 'rzp_live_XXXXXXXXXXXX',          // From Razorpay Dashboard
};
```

---

## Step 3: Add AWS SDK

Add these scripts to the `<head>` of every HTML page that uses AWS:

```html
<!-- AWS SDK -->
<script src="https://sdk.amazonaws.com/js/aws-sdk-2.1477.0.min.js"></script>
<!-- Cognito Identity SDK -->
<script src="https://unpkg.com/amazon-cognito-identity-js@6/dist/amazon-cognito-identity.min.js"></script>
```

Then initialize in your pages:
```javascript
AWS.config.region = XPERTIAL_AWS.region;
AWS.config.credentials = new AWS.CognitoIdentityCredentials({
  IdentityPoolId: XPERTIAL_AWS.identityPoolId,
  Logins: {
    [`cognito-idp.${XPERTIAL_AWS.region}.amazonaws.com/${XPERTIAL_AWS.userPoolId}`]: idToken
  }
});
```

---

## Step 4: Razorpay Setup

1. Create account at https://razorpay.com
2. Complete KYC verification
3. Go to Settings → API Keys → Generate Key
4. Copy `rzp_live_XXXX` key to config
5. For production, create a backend Lambda to generate order IDs:

```javascript
// Lambda function: create-razorpay-order
const Razorpay = require('razorpay');
const razorpay = new Razorpay({
  key_id: process.env.RAZORPAY_KEY_ID,
  key_secret: process.env.RAZORPAY_KEY_SECRET
});

exports.handler = async (event) => {
  const { amount, projectId, type } = JSON.parse(event.body);
  const order = await razorpay.orders.create({
    amount: amount, // paise
    currency: 'INR',
    receipt: `${projectId}_${type}_${Date.now()}`
  });
  return { statusCode: 200, body: JSON.stringify(order) };
};
```

---

## Step 5: Deploy on AWS S3 (Static Hosting)

### Option A: S3 Static Website (Simplest)
1. Create a new S3 bucket: `xpertial-website`
2. Enable Static Website Hosting
3. Upload all files maintaining the folder structure
4. Set bucket policy for public read
5. Use CloudFront for HTTPS + custom domain

```bash
# Install AWS CLI first, then:
aws s3 sync . s3://xpertial-website --exclude "*.md" --delete
```

### Option B: CloudFront + S3 (Recommended for Production)
1. Create CloudFront distribution pointing to your S3 bucket
2. Enable HTTPS (free SSL via ACM)
3. Add your domain in Route 53
4. Set default root: `index.html`
5. Set error page: `/login.html` for 403/404

```bash
# Invalidate CloudFront cache after upload:
aws cloudfront create-invalidation --distribution-id YOUR_DIST_ID --paths "/*"
```

---

## Step 6: Connect Real Data

Replace all mock data in the JS files with real DynamoDB queries.

### Example: Load client projects
```javascript
// In client/index.html, replace MOCK_PROJECTS fetch:
const cognito = new AWS.CognitoIdentityServiceProvider();
const ddb = new AWS.DynamoDB.DocumentClient({ region: XPERTIAL_AWS.region });

const user = xpAuth.getUser();
const projects = await ddb.query({
  TableName: 'xpertial-projects',
  IndexName: 'clientEmail-index',
  KeyConditionExpression: 'clientEmail = :e',
  ExpressionAttributeValues: { ':e': user.email }
}).promise();

renderProjects(projects.Items);
```

---

## Step 7: SES Email Setup (For Notifications)

1. Go to SES → Verify your domain (e.g., xpertial.com)
2. Create email templates for:
   - Request received confirmation
   - Quote sent notification
   - Payment received
   - Dataset ready
3. Create Lambda trigger on DynamoDB Streams to send emails on status changes

---

## File Structure Notes

- All pages use **relative paths** — no server required for local testing
- Open `index.html` directly in browser to preview
- AWS SDK calls are marked with comments: `/* AWS INTEGRATION POINT: */`
- Razorpay calls are marked with comments: `/* RAZORPAY INTEGRATION POINT: */`
- Mock data is clearly marked: `// MOCK — remove in production`

---

## Quick Start Checklist

- [ ] Create AWS account
- [ ] Create S3 bucket: `xpertial-datasets`
- [ ] Create DynamoDB tables (4 tables)
- [ ] Create Cognito User Pool + App Client
- [ ] Create Cognito Identity Pool
- [ ] Update `assets/xpertial.js` with real AWS values
- [ ] Create Razorpay account + add key
- [ ] Deploy files to S3 website bucket
- [ ] Set up CloudFront distribution
- [ ] Connect custom domain in Route 53
- [ ] Replace mock data with DynamoDB queries
- [ ] Set up SES for email notifications

---

## Support

Email: hello@xpertial.com  
Next to build: **Admin Panel** and **Collector App**
