import { useEffect, useRef } from "react";

function Confetti({ points }) {
  const canvasRef = useRef(null);
  useEffect(() => {
    const canvas = canvasRef.current;
    const context = canvas.getContext("2d");
    const density = Math.min(window.devicePixelRatio || 1, 2);
    let width = window.innerWidth;
    let height = window.innerHeight;
    let frameId;
    let lastTime = null;
    const resize = () => {
      width = window.innerWidth;
      height = window.innerHeight;
      canvas.width = width * density;
      canvas.height = height * density;
      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;
      context.setTransform(density, 0, 0, density, 0, 0);
    };
    resize();
    const pieces = Array.from({ length: 140 }, (_, index) => ({
      x: width / 2 + (Math.random() - 0.5) * 18,
      y: height / 2 + (Math.random() - 0.5) * 18,
      size: 5 + Math.random() * 6,
      vx: (Math.random() - 0.5) * Math.max(240, width * 0.55),
      vy: (Math.random() - 0.5) * Math.max(240, height * 0.55),
      gravity: 180 + Math.random() * 160,
      rotation: Math.random() * Math.PI,
      spin: (Math.random() - 0.5) * 8,
      color: ["#ff2d55", "#ff9500", "#ffd60a", "#34c759", "#00c7be", "#0a84ff", "#af52de"][index % 7],
      life: 1,
    }));
    const render = (timestamp) => {
      const delta = lastTime === null ? 0 : Math.min((timestamp - lastTime) / 1000, 0.033);
      lastTime = timestamp;
      context.clearRect(0, 0, width, height);
      let visible = false;
      pieces.forEach((piece) => {
        piece.x += piece.vx * delta;
        piece.y += piece.vy * delta;
        piece.vy += piece.gravity * delta;
        piece.rotation += piece.spin * delta;
        piece.life -= delta / 3.2;
        if (piece.y < height + 20 && piece.life > 0) visible = true;
        context.save();
        context.globalAlpha = Math.max(0, piece.life);
        context.translate(piece.x, piece.y);
        context.rotate(piece.rotation);
        context.fillStyle = piece.color;
        context.fillRect(-piece.size / 2, -piece.size / 2, piece.size, piece.size * 1.8);
        context.restore();
      });
      if (visible) frameId = window.requestAnimationFrame(render);
    };
    window.addEventListener("resize", resize);
    frameId = window.requestAnimationFrame(render);
    return () => {
      window.cancelAnimationFrame(frameId);
      window.removeEventListener("resize", resize);
      context.clearRect(0, 0, width, height);
    };
  }, []);
  return (
    <>
      <canvas ref={canvasRef} className="confetti-canvas" aria-hidden="true" />
      {points !== null && points !== undefined && (
        <div className="confetti-points" aria-live="polite">
          +{points}
        </div>
      )}
    </>
  );
}

export { Confetti };
