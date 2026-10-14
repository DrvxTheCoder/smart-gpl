/* Every storage key the app writes. It still uses its old working name
   ("jauge"); a rename only changes this file (plus a one-off migration of
   the old keys). */

export const CONFIG_KEY = "jauge:config"; // { version, config }, see STORAGE_VERSION
export const LEGACY_CONFIG_KEY = "jauge:config:v1"; // bare v1 config, migrated on boot
export const EDITS_KEY = "jauge:edits:v1"; // inventories changed on this device, by id
export const DENSITY_KEY = "jauge:density"; // a per-device display preference, not tenant config
export const COLLAPSED_KEY = "jauge:sidebar-collapsed";
export const SALES_KEY = "jauge:sales:v1"; // { version, overlay }: sales created on this device
export const SESSION_KEY = "jauge:session"; // mock login: the signed-in demo account id
