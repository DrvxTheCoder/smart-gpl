/* Every storage key the sales module writes. The app still uses its old
   working name ("jauge") here; a rename only changes this file (plus a
   one-off migration of the old keys). */

export const SALES_KEY = "jauge:sales:v1"; // { version, overlay }: what was created on this device
export const ROLE_KEY = "jauge:role"; // prototype role switcher, per device
