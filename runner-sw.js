const loadGame = () => {
  let script = document.createElement("script");
  script.src = "PhigrosLoader_sample.js";
  script.async = true;
  document.head.appendChild(script);
};

const dropStaleWorker = async () => {
  try {
    if (navigator.serviceWorker && navigator.serviceWorker.getRegistrations) {
      const regs = await navigator.serviceWorker.getRegistrations();
      await Promise.all(regs.map((reg) => reg.unregister()));
    }
  } catch (e0) {}
  try {
    if (window.caches && caches.keys) {
      const keys = await caches.keys();
      await Promise.all(keys.map((key) => caches.delete(key)));
    }
  } catch (e1) {}
  loadGame();
};

window.addEventListener("load", dropStaleWorker);
