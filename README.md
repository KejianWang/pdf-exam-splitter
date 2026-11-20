# PDF试卷切分助手

根据 PRD 实现的纯前端 H5 + PWA + Android 离线工具；当前版本 v1.3.1。

## 已实现能力

- 本地 PDF 文件选择与 PC 拖拽导入
- PDF 格式、大小、页数校验（100MB / 200页）
- 显示文件名、页数、文件大小
- 自动按第一页宽高推荐切分方向
- 竖向切分（左右分）/ 横向切分（上下分），支持切割顺序反转
- 30:70 ~ 70:30 比例滑块调节，支持一键重置 50:50
- 页码范围：留空全部切分，支持 `1-5,8`；未命中的页面原样保留
- pdf.js 原文件缩略预览 + 分割线实时预览
- 切割后效果预览
- pdf-lib 矢量裁剪导出，不栅格化、不降低清晰度
- 处理进度与取消
- 输出文件名：`原文件名_切分后.pdf`
- 浏览器下载与 Web Share API 系统分享
- PWA manifest + Service Worker 离线缓存
- v1.2 紧凑化移动端布局、FAQ/隐私折叠面板、快捷预设模板
- v1.3 每页统一铺满标准 A4（595.276×841.89pt）；修复 Service Worker 旧缓存导致新版切分逻辑不生效的问题（缓存名与静态资源均带版本号）
- v1.3.1 修复 90°/270° 旋转 PDF 上下切分顺序颠倒；测试补充 MediaBox/CropBox 原点、裁剪区域及整页缩放矩阵验证
- Web Share Target：安装成 PWA 后，可从支持的安卓系统分享 PDF 到本工具（临时写入 IndexedDB，读取后立即删除）
- 隐私提示、添加桌面引导、使用说明与常见问题

## 目录结构

```text
pdf-exam-splitter/
  public/
    index.html              # 页面入口
    styles.css              # 移动端优先样式
    app.js                  # UI、预览、导入导出、分享逻辑
    pdf-splitter.js         # 可复用PDF切分核心
    sw.js                   # PWA离线缓存 + 分享打开接收
    manifest.webmanifest    # PWA配置
    assets/icon.svg         # 应用图标
    vendor/                 # 本地打包的依赖库，无CDN
      pdf-lib.min.js
      pdf.min.js
      pdf.worker.min.js
  test/smoke-test.js        # Node端核心切分冒烟测试
  package.json
```

## 本地运行

> PWA / Service Worker 需要 HTTP 环境；直接双击 `index.html` 可用核心功能，但无法验证离线缓存。

```powershell
cd ..\pdf-exam-splitter
npm run start
```

然后打开浏览器访问 `http://127.0.0.1:5173`。

## 运行测试

```powershell
cd ..\pdf-exam-splitter
npm test
```

测试会在内存中创建模拟 A3 横版试卷，验证竖向切分、横向切分、页码范围与输出尺寸。若需要保留样例PDF，可运行 `set KEEP_TEST_OUTPUT=1 && npm test`。

## 离线与隐私说明

本项目没有后端接口、没有统计脚本、没有广告脚本，所有运行依赖均放在 `public/vendor`。PDF 读取、预览、切分、导出均在浏览器本机内存完成。PWA 分享打开为了接收安卓系统传入文件，会短暂写入浏览器 IndexedDB，页面读取后立即删除。



## 安卓 APK 打包与安装

本工程已接入 Capacitor Android，APK 已生成到：

```text
..\pdf-exam-splitter\dist\PDF试卷切分助手-v1.3.1-debug.apk
```

重新打包可执行：

```powershell
cd ..\pdf-exam-splitter
npm run apk
```

说明：

- APK 内已打包全部 HTML/CSS/JS/PDF 依赖资源，手机安装后不需要 npm，也不需要联网。
- 打包前会移除 Android `INTERNET` 权限；当前 APK 经 `aapt2 dump permissions` 验证未包含 `android.permission.INTERNET`。
- 当前产物是 debug 签名 APK，适合自用/测试安装。若要正式分发，可后续配置 release keystore 再生成正式签名包。


