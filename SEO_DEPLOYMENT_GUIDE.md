# SEO Post-Deployment Guide

## Overview
After deploying the code changes, follow these steps to consolidate your search rankings and improve visibility for "Diffuse.AI", "Diffuse AI", and "Diffuse press" queries.

## 1. Google Search Console Setup

### Verify www.diffuse.press
1. Go to [Google Search Console](https://search.google.com/search-console)
2. Click "Add Property"
3. Select "URL prefix" and enter: `https://www.diffuse.press`
4. Choose a verification method:
   - **HTML file upload** (recommended): Download the verification file and place it in the `public/` folder
   - **HTML tag**: Add the meta tag to `app/layout.tsx` in the `<head>` section
   - **DNS record**: Add a TXT record to your DNS (if you have access)
5. Click "Verify"

### Submit Sitemap
1. In Google Search Console, go to "Sitemaps" (left sidebar)
2. Enter: `https://www.diffuse.press/sitemap.xml`
3. Click "Submit"
4. Monitor indexing status over the next few days

### Request Indexing for Homepage
1. In Google Search Console, use the URL Inspection tool (top bar)
2. Enter: `https://www.diffuse.press`
3. Click "Request Indexing"
4. Wait 1-2 days for Google to recrawl

## 2. Domain Consolidation (diffuse.ai → www.diffuse.press)

### If you control diffuse.ai domain:

#### Option A: Set up 301 Redirects (Recommended)
Configure your hosting/DNS provider to redirect all traffic:
- `https://diffuse.ai/*` → `https://www.diffuse.press/*`
- `http://diffuse.ai/*` → `https://www.diffuse.press/*`
- `https://www.diffuse.ai/*` → `https://www.diffuse.press/*` (if applicable)

**Where to set this up:**
- **Vercel**: Add redirects in `vercel.json`
- **Netlify**: Add redirects in `netlify.toml` or `_redirects` file
- **Cloudflare**: Use Page Rules or Bulk Redirects
- **Other hosting**: Configure in your web server (nginx, Apache, etc.)

Example `vercel.json` redirect:
```json
{
  "redirects": [
    {
      "source": "/:path*",
      "destination": "https://www.diffuse.press/:path*",
      "permanent": true,
      "host": "diffuse.ai"
    },
    {
      "source": "/:path*",
      "destination": "https://www.diffuse.press/:path*",
      "permanent": true,
      "host": "www.diffuse.ai"
    }
  ]
}
```

#### Option B: Update DNS (if redirect not possible)
1. Point the `diffuse.ai` A/CNAME records to the same server as `www.diffuse.press`
2. Ensure canonical tags point to `www.diffuse.press` (already done in code)

### Add diffuse.ai to Search Console (optional but helpful)
1. Add `https://diffuse.ai` as a separate property in Search Console
2. Set preferred domain to `www.diffuse.press` via canonicals (already done)
3. Monitor any remaining traffic and ensure redirects are working

## 3. Monitoring & Next Steps

### Week 1-2: Initial Indexing
- Check Search Console for crawl errors
- Verify sitemap is processing (should show 1 page indexed)
- Use URL Inspection tool to check if homepage is indexed with correct title/description

### Week 2-4: Ranking Consolidation
- Monitor search queries in Search Console
- Look for appearances of "Diffuse.AI", "Diffuse AI", "Diffuse press"
- Check if your site appears in results for these queries

### Month 1-3: Sitelinks Eligibility
To increase chances of getting sitelinks (extra sections underneath):
1. **Add more public pages** (if not already present):
   - Pricing page (`/pricing`)
   - About page (`/about`)
   - Contact page (`/contact`)
   - Help/FAQ page (`/help`)
   - Blog or resources (`/blog`)

2. **Update sitemap** to include these new pages

3. **Add clear navigation** on homepage linking to these pages

4. **Internal linking**: Ensure all pages link back to homepage and to each other

5. **Structured data**: We've already added Organization, Product, Service, and HowTo schemas - keep these up to date

### Ongoing Maintenance
- Monitor Search Console monthly for:
  - Indexing issues
  - Mobile usability issues
  - Core Web Vitals
  - Manual actions or security issues
- Keep sitemap updated when adding new public pages
- Maintain consistent branding (Diffuse.AI) across all content

## 4. Additional SEO Improvements (Optional)

### Add Google Analytics
Track traffic and user behavior to understand how users find and interact with your site.

### Create a robots.txt file (already generated via app/robots.ts)
Verify it's accessible at: `https://www.diffuse.press/robots.txt`

### Social Media Profiles
Update all social media profiles to link to `www.diffuse.press`:
- Twitter/X (@DiffuseAI)
- LinkedIn (company/diffuse-ai)
- Any other platforms

### Backlinks & PR
- Get listed in AI tool directories
- Submit to Product Hunt, Hacker News, etc.
- Reach out to journalism/news tech blogs for coverage

## Expected Timeline

- **Week 1**: New metadata and sitemap indexed
- **Week 2-4**: Rankings begin to consolidate on www.diffuse.press
- **Month 1-2**: Improved snippet display (no more truncation)
- **Month 2-3**: Potential sitelinks if you add more pages
- **Month 3-6**: Stronger rankings for branded queries

## Troubleshooting

### My site isn't showing up in search
- Verify robots.txt isn't blocking crawlers
- Check Search Console for crawl errors
- Ensure DNS is properly configured
- Wait 1-2 weeks for initial indexing

### Old domain (diffuse.ai) still shows in results
- Confirm 301 redirects are working
- Check canonical tags are correct
- Be patient - can take 4-8 weeks to fully consolidate

### Title is still truncated
- Current title is ~56 characters (optimal)
- Google may still test variations
- Ensure meta description is compelling (currently 261 chars - could shorten to ~155 for better mobile display)

## Questions?
If you need help with any of these steps, consult your hosting provider's documentation or reach out to their support team for assistance with redirects and DNS configuration.
