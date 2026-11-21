## 1.什么是Phi-RR🙂
这是一个Phigros播放器。
由 **[XTHX_FORM](https://space.bilibili.com/2050166809)** 使用`GameMaker-LTS2026`(即**GameMaker Language**)开发

---

## 2.声明❗
该项目仅为学习参考，不属于`Phigros`官方作品，与**鸽游不存在官方合作、技术合作、投资、赞助、联合运营或其他授权、背书关系**

<font color="yellow">⚠⚠⚠</font><font color="red">***请勿用于商业用途***</font><font color="yellow">⚠⚠⚠</font>

---

## 3.当前版本🚀

版本: `v.4.1.2-Next[50007]`

更新日期: **2026.11.22**

---

## 4.Phi-RR支持什么格式🤔

- 支持`RPEN`(兼容到`2.2.0`) , `OPEC`(旧版PE格式) , `Phigros Official`(官谱)。
- 支持`extra.json`(内置Shaders基本支持 , 外置Shader半支持 , 半支持视频播放 ; 如果在播放含外置Shader或视频的谱面有bug，那我也无能为力, 因为我力竭了)
- 支持`line.csv`
---
## 5.支持什么设备💻📱

| 平台 | 客户端适配 | 浏览器适配 |
|:---|:---|:---|
| Windows端 | 完全兼容 | 新版 Google Chrome、Microsoft Edge：完全适配 |
| Linux端 | 不清楚 | 不清楚 |
| Android端 | 不稳定，部分设备不兼容 | Microsoft Edge：基本适配 |
| iOS端 | 不清楚 | 不清楚 |

其他浏览器与平台组合的适配情况均不清楚。

---

## 6.更新日志📝

### 2026.11.22

#### 新增

- 新增了抗锯齿支持
- 新增了 Cloudflare Pages 部署支持

#### 修复

- 修复了加载动画无法正常显示过渡动画
- 修复了皮肤文件无法正常选择的问题
- 修复了手动游玩时噪域声音特效无法触发的问题
- 修复了切至后台时谱面未立即暂停的问题
- 修复了启用垂直同步下，帧率仍然超过刷新率

#### 优化

- 优化了着色器渲染
- 改善了 PhiZone 谱面的兼容性
- 优化了触屏和键盘游玩
- 优化了全屏按钮的显示
