// ==========================================
// INTERACTIVE TOUR — game-style task walkthrough
// ==========================================
//
// Replaces the old "point and describe" tour. Every TASK step locks the app
// behind a click-blocking overlay; the spotlighted element stays interactive
// and the user must actually perform the action before "Continue" unlocks.
//
// Hit-testing: the overlay container is `pointer-events: none`; only the
// click-catcher rects (and the card) re-enable it. Four rects around the
// target leave the target itself fully clickable without relying on z-index
// raising — the raised z 1240 is purely visual.
//
// Layering while active:
//   overlay (click-blocker)    z 1200   (pointer-events: none; rects: auto)
//   dim + gold ring            z 1201   (pointer-events: none)
//   spotlighted element        z 1240   (raised inline, visual only)
//   Mantine portals (modals)   z 1250   (raised via injected CSS)
//   tooltip card               z 1500   (own <body> portal — must stay above
//                                       TARGET_Z, or the raised target's table
//                                       content paints over the card)
//
// Replay mode (force=false) never locks: no click-blocker and no dim — just a
// floating card plus a subtle gold ring — so an established user can re-read
// the walkthrough while keeping the app fully usable.
//
// The tooltip auto-hides while a Mantine modal is open so it never covers the
// form the user is being guided through, then re-appears when it closes.

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

import {
  ActionIcon,
  Button,
  Card,
  Group,
  Stack,
  Text,
} from "@mantine/core";
import {
  Check,
  ChevronLeft,
  ChevronRight,
  Loader2,
  X,
} from "lucide-react";

import { useI18n } from "../i18n/I18nProvider";
import type { OnboardingStep } from "../onboarding/onboardingSteps";

// ----- Layout constants ----------------------------------------------------

const OVERLAY_Z = 1200;
const TARGET_Z = 1240;
const PORTAL_Z = 1250;
// The tooltip must be portaled DIRECTLY to <body> (not inside the overlay
// container) and keep a z-index above TARGET_Z — otherwise the spotlighted
// element (raised to 1240 at the body level, since #root creates no stacking
// context) paints over the card and covers it with whatever is inside it
// (e.g. a table).
const TOOLTIP_Z = 1500;

const DIM = "rgba(5, 10, 28, 0.7)";
const GOLD = "#C9952A";
const SPOTLIGHT_RADIUS = 14;
const TOOLTIP_MAX_W = 380;
const GAP = 16;

interface Rect {
  left: number;
  top: number;
  width: number;
  height: number;
}

type ArrowPlacement = "top" | "bottom" | "left" | "right" | "center";

// ----- CSS (injected while the tour is mounted) ----------------------------

const TOUR_CSS = `
@keyframes ijaz-pop {
  0% { opacity: 0; transform: scale(0.9) translateY(10px); }
  100% { opacity: 1; transform: scale(1) translateY(0); }
}
@keyframes ijaz-bu { 0%,100% { transform: translateY(1px); } 50% { transform: translateY(-5px); } }
@keyframes ijaz-bd { 0%,100% { transform: translateY(-1px); } 50% { transform: translateY(5px); } }
@keyframes ijaz-bl { 0%,100% { transform: translateX(1px); } 50% { transform: translateX(-5px); } }
@keyframes ijaz-br { 0%,100% { transform: translateX(-1px); } 50% { transform: translateX(5px); } }
@keyframes ijaz-ping {
  0% { transform: scale(0.45); opacity: 0.9; }
  100% { transform: scale(2); opacity: 0; }
}
@keyframes ijaz-dot {
  0%,100% { transform: scale(1); opacity: 0.4; }
  50% { transform: scale(0.55); opacity: 1; }
}
@keyframes ijaz-shine {
  0% { left: -75%; }
  55%, 100% { left: 125%; }
}
`;

const BOUNCE_ANIM: Record<Exclude<ArrowPlacement, "center">, string> = {
  top: "ijaz-bu 1s ease-in-out infinite",
  bottom: "ijaz-bd 1s ease-in-out infinite",
  left: "ijaz-bl 1s ease-in-out infinite",
  right: "ijaz-br 1s ease-in-out infinite",
};

// ----- Component -----------------------------------------------------------

export default function InteractiveTour({
  steps,
  stepIndex,
  force,
  taskComplete,
  onNext,
  onClose,
}: {
  steps: OnboardingStep[];
  stepIndex: number;
  force: boolean;
  taskComplete: boolean;
  onNext: () => void;
  onClose: () => void;
}) {
  const { t, dir } = useI18n();
  const [rect, setRect] = useState<Rect | null>(null);
  const [ready, setReady] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const [tooltipSize, setTooltipSize] = useState({ w: TOOLTIP_MAX_W, h: 220 });
  const tooltipRef = useRef<HTMLDivElement>(null);
  const raisedRef = useRef<HTMLElement | null>(null);

  const step = steps[stepIndex];
  const isLast = stepIndex === steps.length - 1;
  const replay = !force;

  // ---- Resolve the spotlight target for the current step -------------------
  function resolveTarget(s: OnboardingStep): HTMLElement | null {
    if (s.freeRegion) {
      const region = document.querySelector<HTMLElement>(s.freeRegion);
      if (region) return region;
    }
    if (s.selector) return document.querySelector<HTMLElement>(s.selector);
    return null;
  }

  // ---- Raise the target above the overlay so it stays usable ----------------
  useEffect(() => {
    if (!step || step.center) return;
    const el = resolveTarget(step);
    if (!el) return;

    el.style.position = "relative";
    el.style.zIndex = String(TARGET_Z);
    raisedRef.current = el;

    return () => {
      if (raisedRef.current === el) {
        el.style.position = "";
        el.style.zIndex = "";
        raisedRef.current = null;
      }
    };
  }, [stepIndex, step?.freeRegion, step?.selector]); // eslint-disable-line react-hooks/exhaustive-deps

  // ---- Focus the target: scroll into view + measure -------------------------
  useEffect(() => {
    setReady(false);
    setRect(null);

    if (!step || step.center) {
      setReady(true);
      return;
    }

    const measure = () => {
      const el = resolveTarget(step);
      if (!el) {
        setRect(null);
        setReady(true);
        return;
      }
      const r = el.getBoundingClientRect();
      setRect({
        left: r.left,
        top: r.top,
        width: r.width,
        height: r.height,
      });
      setReady(true);
    };

    const el = resolveTarget(step);
    if (el) el.scrollIntoView({ block: "center", behavior: "smooth" });

    const timer = window.setTimeout(measure, 480);
    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stepIndex, step?.freeRegion, step?.selector]);

  // ---- Re-measure on resize / scroll / task completion ----------------------
  useEffect(() => {
    if (!step || step.center) return;

    let raf = 0;
    const measure = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        const el = resolveTarget(step);
        if (!el) return;
        const r = el.getBoundingClientRect();
        setRect({
          left: r.left,
          top: r.top,
          width: r.width,
          height: r.height,
        });
      });
    };
    window.addEventListener("resize", measure);
    window.addEventListener("scroll", measure, true);
    return () => {
      window.removeEventListener("resize", measure);
      window.removeEventListener("scroll", measure, true);
      cancelAnimationFrame(raf);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stepIndex, step?.freeRegion, step?.selector, taskComplete]);

  // ---- Keep polling until a late-mounting target appears ---------------------
  // (e.g. the page content that mounts after an AnimatePresence transition).
  useEffect(() => {
    if (!step || step.center || rect) return;

    const id = window.setInterval(() => {
      const el = resolveTarget(step);
      if (!el) return;
      const r = el.getBoundingClientRect();
      setRect({
        left: r.left,
        top: r.top,
        width: r.width,
        height: r.height,
      });
      setReady(true);
    }, 350);

    return () => window.clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stepIndex, step?.freeRegion, step?.selector, rect]);

  // ---- Measure tooltip once rendered ----------------------------------------
  useEffect(() => {
    if (!tooltipRef.current) return;
    setTooltipSize({
      w: tooltipRef.current.offsetWidth || TOOLTIP_MAX_W,
      h: tooltipRef.current.offsetHeight || 220,
    });
  }, [stepIndex, ready, taskComplete]);

  // ---- Hide tooltip while a Mantine modal is open ----------------------------
  // Mantine v9 renders modals in a portal whose content carries
  // `data-modal-content`; a closed modal is unmounted, so presence = open.
  useEffect(() => {
    const node = document.body;
    const check = () => {
      const el = node.querySelector<HTMLElement>("[data-modal-content]");
      if (!el) {
        setModalOpen(false);
        return;
      }
      const cs = window.getComputedStyle(el);
      const visible =
        cs.display !== "none" &&
        cs.visibility !== "hidden" &&
        Number(cs.opacity || "1") > 0;
      setModalOpen(visible);
    };
    check();
    const observer = new MutationObserver(check);
    observer.observe(node, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, []);

  // ---- Mark body so portal-raising CSS applies while the tour is mounted ----
  useEffect(() => {
    document.body.setAttribute("data-onboarding", "true");
    return () => {
      document.body.removeAttribute("data-onboarding");
    };
  }, []);

  // ---- Keyboard: Escape closes the tour only in replay mode ------------------
  useEffect(() => {
    if (force) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [force, onClose]);

  if (!step) return null;

  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const tw = Math.min(TOOLTIP_MAX_W, vw - 24);

  const isFreeRegion = step.freeRegion
    ? Boolean(document.querySelector(step.freeRegion))
    : false;

  const tooltipPos = computeTooltipPos(
    rect,
    tw,
    tooltipSize.h,
    vh,
    vw,
    isFreeRegion,
  );

  const Chevron = dir === "rtl" ? ChevronLeft : ChevronRight;

  const hasTarget = !step.center && rect !== null;

  // The overlay (dim, click-blockers, spotlight ring) lives at OVERLAY_Z.
  // The tooltip card is portaled SEPARATELY, directly to <body>, at TOOLTIP_Z,
  // so no ancestor stacking context can lower it below the raised target.
  const tooltipCard = !modalOpen ? (
    <div
      key={step.id}
      ref={tooltipRef}
      style={{
        position: "fixed",
        left: tooltipPos.left,
        top: tooltipPos.top,
        width: tw,
        zIndex: TOOLTIP_Z,
        pointerEvents: "auto",
        animation: "ijaz-pop 0.42s cubic-bezier(0.22, 1, 0.36, 1)",
      }}
    >
      {tooltipPos.placement !== "center" && hasTarget && !isFreeRegion && (
        <TourArrow placement={tooltipPos.placement} />
      )}
      <TourCard
        step={step}
        index={stepIndex}
        total={steps.length}
        isLast={isLast}
        force={force}
        taskComplete={replay || step.kind !== "task" || taskComplete}
        onNext={onNext}
        onClose={onClose}
        t={t}
        Chevron={Chevron}
      />
    </div>
  ) : null;

  const overlay = createPortal(
    <div
      style={{
        position: "fixed",
        inset: 0,
        zIndex: OVERLAY_Z,
        pointerEvents: "none",
      }}
    >
      <style>{TOUR_CSS}</style>
      {/* CSS: raise Mantine portals (modals, dropdowns) above the overlay —
          only in mandatory mode, where the overlay actually blocks the app */}
      {!replay && (
        <style>{`body[data-onboarding="true"] [data-mantine-portal]{z-index:${PORTAL_Z} !important;}`}</style>
      )}

      {/* Click-catchers: swallow clicks everywhere EXCEPT the target hole.
          We do NOT rely on raising the target above the overlay — that breaks
          when an animated ancestor (e.g. a framer-motion transform) creates
          its own stacking context and traps the raised z-index. Four rects
          around the target leave the target's own clicks untouched.
          Replay mode never blocks — no catchers at all.

          IMPORTANT: when the target is not yet measured (hasTarget=false) but
          still exists in the DOM (e.g. the480ms measurement delay), we do NOT
          show any blocking catcher — that would freeze the entire app. We only
          block when we are certain the target genuinely does not exist in the DOM.
          The deadlock guard in OnboardingProvider handles auto-completion for
          permanently missing targets. */}
      {!replay &&
        (hasTarget && !step.center ? (
        <>
          <CatchRect
            style={{
              left: 0,
              top: 0,
              width: vw,
              height: Math.max(0, rect.top),
            }}
          />
          <CatchRect
            style={{
              left: 0,
              top: Math.min(vh, rect.top + rect.height),
              width: vw,
              height: Math.max(0, vh - rect.top - rect.height),
            }}
          />
          <CatchRect
            style={{
              left: 0,
              top: rect.top,
              width: Math.max(0, rect.left),
              height: rect.height,
            }}
          />
          <CatchRect
            style={{
              left: Math.min(vw, rect.left + rect.width),
              top: rect.top,
              width: Math.max(0, vw - rect.left - rect.width),
              height: rect.height,
            }}
          />
        </>
      ) : null)}

      {/* Visual dim: spotlight hole + gold ring around the target */}
      {!replay && !modalOpen && hasTarget && !step.center && (
        <>
          <div
            style={{
              position: "absolute",
              left: rect.left,
              top: rect.top,
              width: rect.width,
              height: rect.height,
              borderRadius: SPOTLIGHT_RADIUS,
              boxShadow: `0 0 0 9999px ${DIM}`,
              pointerEvents: "none",
              transition: "all 0.35s cubic-bezier(0.22, 1, 0.36, 1)",
            }}
          />
          <div
            style={{
              position: "absolute",
              left: rect.left,
              top: rect.top,
              width: rect.width,
              height: rect.height,
              borderRadius: SPOTLIGHT_RADIUS,
              border: `2px solid ${GOLD}`,
              boxShadow: `0 0 0 4px rgba(201,149,42,0.28), 0 0 28px rgba(201,149,42,0.55)`,
              pointerEvents: "none",
              transition: "all 0.35s cubic-bezier(0.22, 1, 0.36, 1)",
            }}
          />
        </>
      )}

      {/* Full dim when there is no target */}
      {!replay && !modalOpen && !step.center && !hasTarget && (
        <div
          style={{
            position: "absolute",
            inset: 0,
            background: DIM,
            pointerEvents: "none",
          }}
        />
      )}

      {/* Full dim for centered steps */}
      {!replay && !modalOpen && step.center && (
        <div style={{ position: "absolute", inset: 0, background: DIM }} />
      )}

      {/* Replay mode: soft gold ring only — no dim, app stays fully usable */}
      {replay && hasTarget && !step.center && (
        <div
          style={{
            position: "absolute",
            left: rect.left,
            top: rect.top,
            width: rect.width,
            height: rect.height,
            borderRadius: SPOTLIGHT_RADIUS,
            border: `2px solid ${GOLD}`,
            boxShadow: `0 0 0 4px rgba(201,149,42,0.22), 0 0 22px rgba(201,149,42,0.45)`,
            pointerEvents: "none",
            transition: "all 0.35s cubic-bezier(0.22, 1, 0.36, 1)",
          }}
        />
      )}
    </div>,
    document.body,
  );

  return (
    <>
      {overlay}
      {tooltipCard && createPortal(tooltipCard, document.body)}
    </>
  );
}

// ==========================================
// CLICK CATCHER RECT
// ==========================================

function CatchRect({ style }: { style: React.CSSProperties }) {
  return (
    <div
      style={{
        position: "absolute",
        background: "transparent",
        pointerEvents: "auto",
        ...style,
      }}
    />
  );
}

// ==========================================
// TOOLTIP CARD
// ==========================================

const GOLD_BTN = {
  root: {
    position: "relative" as const,
    overflow: "hidden",
    background: "linear-gradient(135deg, #C9952A 0%, #E6C965 100%)",
    color: "#131C39",
    fontWeight: 700,
    boxShadow: "0 8px 20px -6px rgba(201,149,42,0.6)",
    "&:hover": { filter: "brightness(1.06)" },
    "&:disabled": {
      background: "rgba(19,28,57,0.08)",
      color: "#9AA3B5",
      boxShadow: "none",
    },
    "&::after": {
      content: '""',
      position: "absolute",
      top: 0,
      width: "50%",
      height: "100%",
      background:
        "linear-gradient(120deg, transparent, rgba(255,255,255,0.55), transparent)",
      transform: "skewX(-20deg)",
      animation: "ijaz-shine 2.8s ease-in-out infinite",
    },
  },
};

function TourCard({
  step,
  index,
  total,
  isLast,
  force,
  taskComplete,
  onNext,
  onClose,
  t,
  Chevron,
}: {
  step: OnboardingStep;
  index: number;
  total: number;
  isLast: boolean;
  force: boolean;
  taskComplete: boolean;
  onNext: () => void;
  onClose: () => void;
  t: (key: string, params?: Record<string, string | number>) => string;
  Chevron: typeof ChevronRight;
}) {
  const isTask = step.kind === "task";
  const waiting = isTask && !taskComplete;

  return (
    <Card
      radius="lg"
      padding={0}
      shadow="xl"
      style={{
        overflow: "hidden",
        background: "var(--app-surface)",
        border: "1px solid var(--app-border)",
      }}
    >
      {/* Gold accent strip */}
      <div
        style={{
          height: 5,
          background:
            "linear-gradient(90deg, #C9952A 0%, #E6C965 55%, #C9952A 100%)",
        }}
      />
      <div style={{ padding: "16px 20px 14px" }}>
        <Group justify="space-between" align="flex-start" wrap="nowrap">
          <Group gap="sm" wrap="nowrap">
            <IconBadge>{step.icon}</IconBadge>
            <Stack gap={2}>
              <Text fw={800} size="sm" style={{ color: "var(--app-text)", letterSpacing: -0.2 }}>
                {t(step.titleKey)}
              </Text>
              <Text
                size="xs"
                fw={700}
                style={{ color: GOLD, letterSpacing: 1.2, textTransform: "uppercase" }}
              >
                {t("tour.stepXofY", { current: index + 1, total })}
              </Text>
            </Stack>
          </Group>
          {!force && (
            <ActionIcon
              size="sm"
              variant="subtle"
              color="gray"
              onClick={onClose}
              aria-label={t("tour.skip")}
            >
              <X size={14} />
            </ActionIcon>
          )}
        </Group>

        <Text size="sm" mt={10} style={{ color: "var(--app-text-soft)", lineHeight: 1.65 }}>
          {t(step.contentKey)}
        </Text>

        {/* Task status strip */}
        {isTask && (
          <Group
            gap="xs"
            mt="sm"
            wrap="nowrap"
            style={{
              borderRadius: 10,
              padding: "8px 10px",
              background: waiting
                ? "rgba(201,149,42,0.10)"
                : "rgba(34,197,94,0.12)",
              border: waiting
                ? "1px solid rgba(201,149,42,0.35)"
                : "1px solid rgba(34,197,94,0.4)",
            }}
          >
            {waiting ? (
              <>
                <span
                  style={{
                    width: 10,
                    height: 10,
                    borderRadius: 99,
                    background: GOLD,
                    animation: "ijaz-dot 1.2s ease-in-out infinite",
                  }}
                />
                <Text size="xs" fw={700} style={{ color: "var(--app-gold-deep)", lineHeight: 1.4 }}>
                  {step.hintKey ? t(step.hintKey) : t("tour.waiting")}
                </Text>
              </>
            ) : (
              <>
                <span
                  style={{
                    width: 18,
                    height: 18,
                    borderRadius: 99,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    background: "#22C55E",
                    color: "#fff",
                    flexShrink: 0,
                  }}
                >
                  <Check size={12} strokeWidth={3} />
                </span>
                <Text size="xs" fw={700} style={{ color: "#15803D", lineHeight: 1.4 }}>
                  {t("tour.completed")}
                </Text>
              </>
            )}
          </Group>
        )}

        <Group justify="space-between" align="center" mt="md" wrap="nowrap">
          <ProgressDots index={index} total={total} />
          <Button
            size="sm"
            rightSection={!waiting && <Chevron size={15} />}
            loading={waiting ? false : undefined}
            disabled={waiting}
            onClick={onNext}
            styles={GOLD_BTN}
          >
            {waiting ? (
              <>
                <Loader2 size={14} style={{ marginRight: 6 }} />
                {t("tour.waiting")}
              </>
            ) : isLast ? (
              t("tour.finish")
            ) : isTask ? (
              t("tour.continue")
            ) : (
              t("tour.next")
            )}
          </Button>
        </Group>
      </div>
    </Card>
  );
}

function IconBadge({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        width: 40,
        height: 40,
        borderRadius: 12,
        flexShrink: 0,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background:
          "linear-gradient(135deg, rgba(201,149,42,0.18), rgba(230,201,101,0.32))",
        color: "#A9741A",
        border: "1px solid rgba(201,149,42,0.35)",
        boxShadow: "0 4px 12px -4px rgba(201,149,42,0.4)",
      }}
    >
      {children}
    </div>
  );
}

function ProgressDots({ index, total }: { index: number; total: number }) {
  return (
    <Group gap={6}>
      {Array.from({ length: total }).map((_, i) => (
        <span
          key={i}
          style={{
            display: "inline-block",
            width: i === index ? 22 : i < index ? 14 : 7,
            height: 7,
            borderRadius: 99,
            background:
              i === index
                ? GOLD
                : i < index
                  ? "rgba(201,149,42,0.45)"
                  : "rgba(19,28,57,0.15)",
            transition: "all 0.35s cubic-bezier(0.22, 1, 0.36, 1)",
          }}
        />
      ))}
    </Group>
  );
}

// ==========================================
// ANIMATED POINTER ARROW
// ==========================================

function TourArrow({ placement }: { placement: Exclude<ArrowPlacement, "center"> }) {
  const size = 48;
  const container: React.CSSProperties = (() => {
    switch (placement) {
      case "top":
        return { top: -7, left: "50%", marginLeft: -size / 2 };
      case "bottom":
        return { bottom: -7, left: "50%", marginLeft: -size / 2 };
      case "left":
        return { left: -7, top: "50%", marginTop: -size / 2 };
      case "right":
        return { right: -7, top: "50%", marginTop: -size / 2 };
    }
  })();

  const tri: React.CSSProperties = (() => {
    switch (placement) {
      case "top":
        return {
          top: 4,
          left: "50%",
          marginLeft: -11,
          borderLeft: "11px solid transparent",
          borderRight: "11px solid transparent",
          borderBottom: "17px solid #E6C965",
        };
      case "bottom":
        return {
          bottom: 4,
          left: "50%",
          marginLeft: -11,
          borderLeft: "11px solid transparent",
          borderRight: "11px solid transparent",
          borderTop: "17px solid #E6C965",
        };
      case "left":
        return {
          left: 4,
          top: "50%",
          marginTop: -11,
          borderTop: "11px solid transparent",
          borderBottom: "11px solid transparent",
          borderRight: "17px solid #E6C965",
        };
      case "right":
        return {
          right: 4,
          top: "50%",
          marginTop: -11,
          borderTop: "11px solid transparent",
          borderBottom: "11px solid transparent",
          borderLeft: "17px solid #E6C965",
        };
    }
  })();

  const ping: React.CSSProperties = (() => {
    const ring = { width: 20, height: 20 };
    switch (placement) {
      case "top":
        return { ...ring, top: 2, left: "50%", marginLeft: -10 };
      case "bottom":
        return { ...ring, bottom: 2, left: "50%", marginLeft: -10 };
      case "left":
        return { ...ring, left: 2, top: "50%", marginTop: -10 };
      case "right":
        return { ...ring, right: 2, top: "50%", marginTop: -10 };
    }
  })();

  return (
    <div
      style={{
        position: "absolute",
        width: size,
        height: size,
        zIndex: 3,
        pointerEvents: "none",
        ...container,
      }}
    >
      <div
        style={{
          position: "absolute",
          borderRadius: "50%",
          background:
            "radial-gradient(circle, rgba(230,201,101,0.95) 0%, rgba(201,149,42,0.25) 55%, transparent 78%)",
          animation: "ijaz-ping 1.5s ease-out infinite",
          ...ping,
        }}
      />
      <div
        style={{
          position: "absolute",
          filter: "drop-shadow(0 0 7px rgba(201,149,42,0.85))",
          animation: BOUNCE_ANIM[placement],
          ...tri,
        }}
      />
    </div>
  );
}

// ==========================================
// POSITIONING
// ==========================================

function computeTooltipPos(
  rect: Rect | null,
  tw: number,
  th: number,
  vh: number,
  vw: number,
  isFreeRegion: boolean,
): { left: number; top: number; placement: ArrowPlacement } {
  // Free regions (e.g. the import wizard) keep the card pinned to the top so
  // it never blocks the guided workflow below.
  if (isFreeRegion && rect) {
    return {
      left: Math.min(Math.max((vw - tw) / 2, 12), vw - tw - 12),
      top: 16,
      placement: "center",
    };
  }

  if (!rect) {
    return {
      left: Math.max(12, (vw - tw) / 2),
      top: 24,
      placement: "center",
    };
  }

  const margin = 12;

  if (rect.height > vh * 0.55 || rect.width > vw * 0.55) {
    return {
      top: Math.min(Math.max(rect.top + rect.height / 2 - th / 2, margin), vh - th - margin),
      left: Math.min(Math.max(rect.left + rect.width / 2 - tw / 2, margin), vw - tw - margin),
      placement: "center",
    };
  }

  const below = rect.top + rect.height + GAP + th;
  const above = rect.top - GAP - th;
  const clampH = (x: number) => Math.min(Math.max(x, margin), vw - tw - margin);

  if (below <= vh - margin) {
    return {
      top: rect.top + rect.height + GAP,
      left: clampH(rect.left + rect.width / 2 - tw / 2),
      placement: "bottom",
    };
  }
  if (above >= margin) {
    return {
      top: rect.top - GAP - th,
      left: clampH(rect.left + rect.width / 2 - tw / 2),
      placement: "top",
    };
  }

  const sideTop = Math.min(
    Math.max(rect.top + rect.height / 2 - th / 2, margin),
    vh - th - margin,
  );
  const right = rect.left + rect.width + GAP + tw;
  if (right <= vw - margin) {
    return { top: sideTop, left: rect.left + rect.width + GAP, placement: "left" };
  }
  const left = rect.left - GAP - tw;
  if (left >= margin) {
    return { top: sideTop, left, placement: "right" };
  }
  return { top: margin, left: margin, placement: "center" };
}
