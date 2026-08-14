import Lottie, { type LottieComponentProps } from "lottie-react";
import type { CSSProperties } from "react";

type Props = Pick<
  LottieComponentProps,
  "animationData" | "loop" | "autoplay"
> & {
  size?: number | string;
  className?: string;
  style?: CSSProperties;
};

export default function LottieAnimation({
  animationData,
  loop = true,
  autoplay = true,
  size,
  className,
  style,
}: Props) {
  return (
    <Lottie
      animationData={animationData}
      loop={loop}
      autoplay={autoplay}
      className={className}
      style={{ width: size ?? "100%", height: size ?? "100%", ...style }}
    />
  );
}
