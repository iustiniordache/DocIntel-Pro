# Web Deployment - Quick Reference Card

## 🚀 Deploy in 3 Commands

```bash
cd infra
pnpm install && pnpm build
pnpm deploy:web              # 5-10 min (first time)
pnpm deploy:web:content      # 1-2 min
```

## 📋 Essential Commands

| Task                      | Command                   |
| ------------------------- | ------------------------- |
| **Deploy Infrastructure** | `pnpm deploy:web`         |
| **Update Content**        | `pnpm deploy:web:content` |
| **Preview Changes**       | `pnpm diff:web`           |
| **View Template**         | `pnpm synth:web`          |
| **Delete Everything**     | `pnpm destroy:web`        |

## 🔗 Get Your URLs

```bash
# Website URL
aws cloudformation describe-stacks --stack-name DocIntelProWebStack \
  --query 'Stacks[0].Outputs[?OutputKey==`WebsiteURL`].OutputValue' --output text

# Distribution ID
aws cloudformation describe-stacks --stack-name DocIntelProWebStack \
  --query 'Stacks[0].Outputs[?OutputKey==`DistributionId`].OutputValue' --output text
```

## ⚡ Update After Code Changes

```bash
cd infra
pnpm deploy:web:content
```

This automatically:

1. Builds Next.js app
2. Uploads to S3
3. Invalidates CloudFront cache

## 🔧 Configuration

**Set API URL** (`apps/web/.env.local`):

```env
NEXT_PUBLIC_API_URL=https://your-api.execute-api.us-east-1.amazonaws.com/prod
```

## 🐛 Quick Troubleshooting

| Issue               | Fix                              |
| ------------------- | -------------------------------- |
| **403 Forbidden**   | `pnpm deploy:web`                |
| **Stale content**   | Wait 1-2 min (auto-invalidation) |
| **Build not found** | `cd apps/web && pnpm build`      |
| **Stack not found** | `pnpm deploy:web` first          |

## 📊 Check Status

```bash
# Stack status
aws cloudformation describe-stacks --stack-name DocIntelProWebStack \
  --query 'Stacks[0].StackStatus' --output text

# Distribution status
DIST_ID=$(aws cloudformation describe-stacks --stack-name DocIntelProWebStack \
  --query 'Stacks[0].Outputs[?OutputKey==`DistributionId`].OutputValue' --output text)
aws cloudfront get-distribution --id $DIST_ID \
  --query 'Distribution.Status' --output text
```

## 💡 Pro Tips

1. **Save time**: Use `pnpm deploy:web:content` for content-only updates
2. **Test first**: Run `pnpm diff:web` before deploying
3. **Monitor**: CloudFormation Console → Events tab
4. **Costs**: Check AWS Cost Explorer after 24 hours

## 📚 Full Docs

- **Quick Start**: `WEB_QUICKSTART.md`
- **Complete Guide**: `WEB_DEPLOYMENT.md`
- **Overview**: `README.md`
- **Implementation**: `IMPLEMENTATION_SUMMARY.md`

## 🎯 Success Check

✅ Stack deployed → Check CloudFormation Console ✅ Site accessible → Visit CloudFront URL
✅ All pages work → Test navigation ✅ API connected → Check browser console

---

**Need Help?** See `WEB_DEPLOYMENT.md` → Troubleshooting
