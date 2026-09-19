import { useEffect, useRef } from "react";
import { motion, useReducedMotion, useSpring } from "framer-motion";
import { ArrowUpRight, MoveUpRight, Command } from "lucide-react";

export interface AetherFlowHeroProps {
  onCreate(): void;
  onExplore(): void;
  projectCount: number;
}

/** A bounded particle field: CSS pixels, capped pairs, stable seed, no motion when hidden. */
function IntentField() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const reduceMotion = useReducedMotion();
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d"); if (!ctx) return;
    let width = 0, height = 0, frame = 0, visible = true, last = 0;
    const mouse = { x: -1000, y: -1000 };
    let particles: Array<{ x: number; y: number; vx: number; vy: number }> = [];
    const draw = (time: number) => {
      frame = 0;
      if (!visible || document.hidden) return;
      const elapsed = Math.min(2, (time - last) / 33 || 1); last = time;
      ctx.clearRect(0, 0, width, height);
      for (const p of particles) {
        if (!reduceMotion) {
          const dx = p.x - mouse.x, dy = p.y - mouse.y, d = Math.hypot(dx, dy);
          if (d > 0 && d < 110) { p.x += dx / d * (1 - d / 110); p.y += dy / d * (1 - d / 110); }
          p.x = (p.x + p.vx * elapsed + width) % width;
          p.y = (p.y + p.vy * elapsed + height) % height;
        }
        ctx.fillStyle = "rgba(198,249,57,.65)"; ctx.fillRect(p.x, p.y, 2, 2);
      }
      for (let a = 0; a < particles.length; a++) for (let b = a + 1; b < particles.length; b++) {
        const p = particles[a]!, q = particles[b]!, d = Math.hypot(p.x - q.x, p.y - q.y);
        if (d < 108) {
          ctx.strokeStyle = `rgba(198,249,57,${Math.max(0, .15 * (1 - d / 108))})`;
          ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(q.x, q.y); ctx.stroke();
        }
      }
      if (!reduceMotion) frame = requestAnimationFrame(draw);
    };
    const resume = () => { if (!frame && !document.hidden && visible) frame = requestAnimationFrame(draw); };
    const resize = new ResizeObserver(([entry]) => {
      if (!entry) return;
      width = entry.contentRect.width; height = entry.contentRect.height;
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = Math.round(width * dpr); canvas.height = Math.round(height * dpr); ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      let seed = 4271;
      const next = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
      particles = Array.from({ length: Math.min(64, Math.floor(width * height / 5000)) }, () => ({ x: next() * width, y: next() * height, vx: next() * .3 - .15, vy: next() * .3 - .15 }));
      resume();
    });
    const observer = new IntersectionObserver(([entry]) => { visible = entry?.isIntersecting ?? false; if (visible) resume(); else cancelAnimationFrame(frame); if (!visible) frame = 0; });
    const onMove = (event: PointerEvent) => { const box = canvas.getBoundingClientRect(); mouse.x = event.clientX - box.left; mouse.y = event.clientY - box.top; };
    const leave = () => { mouse.x = mouse.y = -1000; };
    const parent = canvas.parentElement!;
    resize.observe(canvas); observer.observe(canvas); parent.addEventListener("pointermove", onMove); parent.addEventListener("pointerleave", leave);
    document.addEventListener("visibilitychange", resume);
    resume();
    return () => { cancelAnimationFrame(frame); resize.disconnect(); observer.disconnect(); parent.removeEventListener("pointermove", onMove); parent.removeEventListener("pointerleave", leave); document.removeEventListener("visibilitychange", resume); };
  }, [reduceMotion]);
  return <canvas className="xr-intent-field" ref={canvasRef} aria-hidden="true" />;
}

export default function AetherFlowHero({ onCreate, onExplore, projectCount }: AetherFlowHeroProps) {
  const reduced = useReducedMotion();
  const x = useSpring(0, { stiffness: 140, damping: 24 });
  const y = useSpring(0, { stiffness: 140, damping: 24 });
  return <section className="xr-hero" aria-labelledby="intent-title">
    <div className="xr-hero__copy">
      <span className="xr-kicker"><span className="xr-square" /> A place for what comes next</span>
      <h1 id="intent-title">Give your<br />ideas <span>form.</span></h1>
      <p>Research, shape, make, deliver.<br />Your intent is the interface. Every step stays yours.</p>
      <div className="xr-hero__actions">
        <button className="xr-button xr-button--primary" onClick={onCreate}>Start a World <ArrowUpRight size={18} /></button>
        <button className="xr-text-action" onClick={onExplore}>Bring the web in <MoveUpRight size={15} /></button>
      </div>
      <div className="xr-hero__foot"><span>{projectCount.toString().padStart(2, "0")} Worlds on your machine</span><span><Command size={12} /> K to ask for anything</span></div>
    </div>
    <div className="xr-hero__art" onPointerMove={(event) => {
      if (reduced || event.pointerType !== "mouse") return;
      const box = event.currentTarget.getBoundingClientRect(); x.set((event.clientX - box.left - box.width / 2) * .035); y.set((event.clientY - box.top - box.height / 2) * .035);
    }} onPointerLeave={() => { x.set(0); y.set(0); }}>
      <IntentField />
      <div className="xr-hero__coordinate">INTENT / 001</div>
      <motion.div className="xr-hero__structure" style={{ x: reduced ? 0 : x, y: reduced ? 0 : y }} aria-hidden="true">
        <div className="xr-hero__orbit xr-hero__orbit--one" /><div className="xr-hero__orbit xr-hero__orbit--two" />
        <div className="xr-hero__plane xr-hero__plane--back"><span>Research</span></div>
        <div className="xr-hero__plane xr-hero__plane--mid"><span>Decisions</span></div>
        <div className="xr-hero__plane xr-hero__plane--front"><span>Living Object</span><strong>From thought<br />to thing.</strong><ArrowUpRight size={32} /></div>
        <span className="xr-hero__annotation">Human judgment.<br />Digital capability.</span>
      </motion.div>
      <div className="xr-hero__legend"><span>01 Idea</span><span>02 Process</span><span>03 Outcome</span></div>
    </div>
  </section>;
}
