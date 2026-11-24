(function () {
  'use strict';

  const Nexus = (window.Nexus = window.Nexus || {});
  const loadedImages = new Map();

  function disposeAll() {
    // No animation loops are kept running in idle state to keep launcher RAM ultra-low.
    // Trim image cache if oversized.
    if (loadedImages.size > 24) {
      loadedImages.clear();
    }
  }

  function drawSkinModel(canvas, img, model) {
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const w = canvas.width;
    const h = canvas.height;
    ctx.clearRect(0, 0, w, h);
    ctx.imageSmoothingEnabled = false;

    const isLegacy32 = img.height === 32;
    const armW = model === 'slim' ? 3 : 4;
    const scale = 6;
    const centerX = Math.floor(w / 2);
    const topY = 14;

    // Ground shadow
    ctx.fillStyle = 'rgba(240, 178, 58, 0.16)';
    ctx.beginPath();
    ctx.ellipse(centerX, topY + 32 * scale + 6, 9 * scale, 2.2 * scale, 0, 0, Math.PI * 2);
    ctx.fill();

    const drawPart = (sx, sy, sw, sh, dx, dy, dw, dh) => {
      ctx.drawImage(img, sx, sy, sw, sh, dx, dy, dw, dh);
    };

    const headW = 8 * scale;
    const bodyW = 8 * scale;
    const bodyH = 12 * scale;
    const legW = 4 * scale;
    const legH = 12 * scale;
    const armPxW = armW * scale;

    const headX = centerX - headW / 2;
    const bodyX = centerX - bodyW / 2;
    const bodyY = topY + headW;
    const legsY = bodyY + bodyH;

    // Base layers
    // Head
    drawPart(8, 8, 8, 8, headX, topY, headW, headW);
    // Torso
    drawPart(20, 20, 8, 12, bodyX, bodyY, bodyW, bodyH);
    // Right Arm
    drawPart(44, 20, armW, 12, bodyX - armPxW, bodyY, armPxW, bodyH);
    // Left Arm (64x64 has separate left arm at 36,52; 64x32 mirrors right arm)
    if (isLegacy32) {
      drawPart(44, 20, armW, 12, bodyX + bodyW, bodyY, armPxW, bodyH);
    } else {
      drawPart(36, 52, armW, 12, bodyX + bodyW, bodyY, armPxW, bodyH);
    }
    // Right Leg
    drawPart(4, 20, 4, 12, centerX - legW, legsY, legW, legH);
    // Left Leg
    if (isLegacy32) {
      drawPart(4, 20, 4, 12, centerX, legsY, legW, legH);
    } else {
      drawPart(20, 52, 4, 12, centerX, legsY, legW, legH);
    }

    // Outer overlay layers on 64x64 skins (hat, jacket, sleeves, pants)
    if (!isLegacy32) {
      drawPart(40, 8, 8, 8, headX - 2, topY - 2, headW + 4, headW + 4);
      drawPart(20, 36, 8, 12, bodyX, bodyY, bodyW, bodyH);
      drawPart(44, 36, armW, 12, bodyX - armPxW, bodyY, armPxW, bodyH);
      drawPart(52, 52, armW, 12, bodyX + bodyW, bodyY, armPxW, bodyH);
      drawPart(4, 36, 4, 12, centerX - legW, legsY, legW, legH);
      drawPart(4, 52, 4, 12, centerX, legsY, legW, legH);
    }
  }

  function mountOne(box) {
    const url = box.getAttribute('data-skin-url');
    const model = box.getAttribute('data-skin-model') === 'slim' ? 'slim' : 'classic';
    if (!url) return;

    let canvas = box.querySelector('canvas');
    if (!canvas) {
      canvas = document.createElement('canvas');
      canvas.width = 180;
      canvas.height = 220;
      box.innerHTML = '';
      box.appendChild(canvas);
    }

    const cached = loadedImages.get(url);
    if (cached && cached.complete && cached.naturalWidth > 0) {
      drawSkinModel(canvas, cached, model);
      return;
    }

    const img = new Image();
    img.onload = () => {
      loadedImages.set(url, img);
      if (canvas.isConnected) drawSkinModel(canvas, img, model);
    };
    img.src = url;
  }

  function mountAll(container) {
    if (!container) return;
    const targets = container.querySelectorAll('.skin-preview[data-skin-url]');
    for (let i = 0; i < targets.length; i++) {
      mountOne(targets[i]);
    }
  }

  Nexus.skinPreview = Object.freeze({
    mountAll,
    disposeAll
  });
})();
