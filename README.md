# PhantomForce Static Site

This folder is ready for GitHub Pages.

## Publish

1. Create a GitHub repository, for example `phantomforce`.
2. Upload everything in this folder to the repository root.
3. In GitHub, open **Settings > Pages**.
4. Set the source to the `main` branch and `/root`.
5. Keep the included `CNAME` file so GitHub Pages knows the custom domain is `phantomforce.online`.

## DNS

Point `phantomforce.online` to GitHub Pages:

```text
A     @     185.199.108.153
A     @     185.199.109.153
A     @     185.199.110.153
A     @     185.199.111.153
CNAME www   KIDWST.github.io
```

After DNS propagates, enable **Enforce HTTPS** in GitHub Pages.
