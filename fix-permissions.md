# Fix Firebase App Hosting Secret Manager Permissions

## 1. Find your App Hosting service account
In Google Cloud Console > IAM & Admin > Service Accounts, look for:
- `firebase-apphosting@studio-5587063777-d2e6c.iam.gserviceaccount.com`
- Or similar pattern with your project ID

## 2. Grant Secret Manager permissions
Run these commands in Google Cloud Shell:

```bash
# Replace with your actual project ID and service account
PROJECT_ID="studio-5587063777-d2e6c"
SERVICE_ACCOUNT="firebase-apphosting@${PROJECT_ID}.iam.gserviceaccount.com"

# Grant Secret Manager Secret Accessor role
gcloud projects add-iam-policy-binding $PROJECT_ID \
  --member="serviceAccount:${SERVICE_ACCOUNT}" \
  --role="roles/secretmanager.secretAccessor"

# Grant Secret Manager Viewer role (optional but recommended)
gcloud projects add-iam-policy-binding $PROJECT_ID \
  --member="serviceAccount:${SERVICE_ACCOUNT}" \
  --role="roles/secretmanager.viewer"
```

## 3. Alternative: Use Firebase CLI
```bash
firebase apphosting:secrets:grantaccess --project=studio-5587063777-d2e6c
```

## 4. Verify permissions
After granting permissions, redeploy and test:
- `/api/debug-env` - Check if DISCORD_BOT_TOKEN is loaded
- `/api/test-discord` - Test Discord API connection