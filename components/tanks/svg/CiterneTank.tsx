import { TANK_GEOMETRY } from "../tankGeometry";
import type { TankArt } from "./types";

/* Cleaned from public/assets/illustrations/CITERNE.svg: fills as attributes.
   The top rail and base plate sit over everything, so they go in `structure`. */

const { clipBox } = TANK_GEOMETRY.citerne;

const BODY = "M69.92,10.72v52.18H5.27V10.72C5.27,4.93,19.64.21,37.6.01c17.96.2,32.32,4.92,32.32,10.71Z";
const LEFT_SHADE = "M25.65.57c-3.42,1.8-5.4,3.96-5.4,6.27v56.06H2.9V10.72C2.9,6,12.42,2,25.65.57Z";
const DOME_RIM = "M37.6.01C19.64.21,5.27,4.93,5.27,10.72v52.18h-2.37V10.72C2.9,4.8,17.9,0,36.41,0c.4,0,.79,0,1.19.01Z";
const SEAMS = [26.46, 44.85];

export const citerneArt: TankArt = {
  clip: () => <rect x={clipBox.x} y={clipBox.y} width={clipBox.w} height={clipBox.h} />,

  back: () => (
    <>
      {/* Shell */}
      <path fill="#96a5bc" d={BODY} />
      <path fill="#8696b0" d={LEFT_SHADE} />
      <path fill="#a2b5d1" d={DOME_RIM} />
      <rect fill="#a2b5d1" x="4.32" y="9.65" width="65.6" height="1.07" />
      {/* Weld seams */}
      <g fill="#6b7e99">
        {SEAMS.map((y) => (
          <rect key={y} x="2.9" y={y} width="67.02" height="1.07" />
        ))}
      </g>
    </>
  ),

  front: () => (
    <>
      {/* Left shading, seams and highlight strip, translucent so the liquid reads as inside the shell */}
      <path fill="#2a384c" opacity="0.16" d={LEFT_SHADE} />
      <g fill="#6b7e99" opacity="0.55">
        {SEAMS.map((y) => (
          <rect key={y} x="2.9" y={y} width="67.02" height="1.07" />
        ))}
      </g>
      <rect fill="#bed3ee" opacity="0.3" x="59.64" y="14.69" width="8.31" height="45.49" rx="1.53" />
      {/* Inner wall edge */}
      <rect
        x={clipBox.x}
        y={clipBox.y}
        width={clipBox.w}
        height={clipBox.h}
        fill="none"
        stroke="#475b7a"
        strokeOpacity="0.3"
        strokeWidth="0.35"
      />
    </>
  ),

  structure: () => (
    <>
      <rect fill="#2a384c" y="62.9" width="72.83" height="3.31" />
      {/* Top rail */}
      <g fill="#6b7e99">
        <rect x="2.9" y="7.68" width="67.02" height="3.04" />
        <rect x="2.9" y="4.2" width="67.02" height=".25" />
        <rect x="2.9" y="6.37" width="67.02" height=".25" />
        {[3.75, 20.02, 36.29, 52.56, 68.82].map((x) => (
          <rect key={x} x={x} y="4.32" width=".25" height="3.36" />
        ))}
      </g>
    </>
  ),
};
