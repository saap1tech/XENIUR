import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from "react";
import { motion, useReducedMotion } from "framer-motion";
import { ArrowUpRight } from "lucide-react";
import { cn } from "../../lib/utils.js";

export interface FolderCardProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, "onAnimationStart" | "onDragStart" | "onDragEnd" | "onDrag"> {
  title: string; subtitle?: string; count?: ReactNode; countLabel?: string; meta?: string;
  cover?: string; coverAlt?: string; interactive?: boolean; index?: number;
}
/** The supplied folder interaction, adapted to an accessible button and XENIUR's material palette. */
export const FolderCard = forwardRef<HTMLButtonElement, FolderCardProps>(function FolderCard({
  title, subtitle = "Living workspace", count, countLabel = "", meta = "Open World",
  cover, coverAlt = "", interactive = true, index = 0, className, ...props
}, ref) {
  const reduced = useReducedMotion();
  return <motion.button ref={ref} type="button" className={cn("xr-folder", className)}
    initial="rest" animate="rest" whileHover={interactive && !reduced ? "hover" : undefined}
    whileTap={interactive && !reduced ? { scale: .985 } : undefined}
    aria-label={`Open ${title}`} {...props}>
    <span className={`xr-folder__cover xr-folder__cover--${index % 4}`}>
      <motion.span className="xr-folder__art" variants={{ rest: { scale: 1 }, hover: { scale: 1.05 } }} transition={{ type: "spring", stiffness: 260, damping: 26 }}>
        {cover ? <img src={cover} alt={coverAlt} draggable={false} /> : <><span className="xr-folder__grid" /><span className="xr-folder__glyph" aria-hidden="true">{["Aa", "◉", "↗", "[]"][index % 4]}</span></>}
      </motion.span>
      <span className="xr-folder__number">WORLD / {String(index + 1).padStart(2, "0")}</span>
    </span>
    <motion.span className="xr-folder__panel" variants={{ rest: { y: 0 }, hover: { y: 12 } }} transition={{ type: "spring", stiffness: 260, damping: 26 }}>
      <span className="xr-folder__tab" /><strong>{title}</strong><span className="xr-folder__subtitle">{subtitle}</span>
    </motion.span>
    <span className="xr-folder__footer"><span>{count != null && <b>{count} </b>}{countLabel || meta}</span><ArrowUpRight size={20} /></span>
  </motion.button>;
});
export default FolderCard;
