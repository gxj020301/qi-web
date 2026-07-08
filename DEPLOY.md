# GitHub Pages 部署检查

这个目录是静态网站发布目录，入口文件是 `index.html`。

## 推荐设置

1. 如果仓库只放这个网站，把 `index.html`、`styles.css`、`app.js`、`qi-db.js`、`qi-hot-db.js` 放在仓库根目录。
2. 如果仓库里保留 `qi-web/` 子目录，GitHub Pages 的访问地址应包含 `/qi-web/`，例如：
   `https://<username>.github.io/<repo>/qi-web/`
3. 在 GitHub 仓库页面进入 `Settings` -> `Pages`：
   - Source 选择 `Deploy from a branch`
   - Branch 选择 `main`
   - Folder 选择 `/root`
4. 确认发布目录中包含 `.nojekyll`，让 GitHub Pages 原样发布静态文件。
5. 如果云端中文乱码，优先确认浏览器打开的是 GitHub Pages 地址，而不是 GitHub 的代码预览页或 raw 文件地址。

## 必须上传的文件

- `index.html`
- `styles.css`
- `app.js`
- `qi-db.js`
- `qi-hot-db.js`
- `.nojekyll`

