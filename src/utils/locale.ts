import type { Payload } from "payload";

export interface LocaleConfig {
  defaultLocale: string;
  locales: string[];
}

/**
 * Extract configured locales from Payload config.
 * Returns the locale codes and default locale, or null if localization is disabled.
 */
export function getLocaleConfig(payload: Payload): LocaleConfig | null {
  const loc = payload.config.localization;
  if (!loc) {
    return null;
  }

  const locales = loc.locales.map((l: string | { code: string }) =>
    typeof l === "string" ? l : l.code
  );

  const defaultLocale =
    typeof loc.defaultLocale === "string"
      ? loc.defaultLocale
      : locales[0] || "en";

  return { locales, defaultLocale };
}

/**
 * Format available locales for display. E.g. "sk (default), cz"
 */
export function formatLocales(config: LocaleConfig): string {
  return config.locales
    .map((l) => (l === config.defaultLocale ? `${l} (default)` : l))
    .join(", ");
}

/**
 * Validate a --locale value against configured locales.
 * "all" is always valid (Payload native — returns all locale values as an object).
 * Prints error + exits if invalid or localization is not configured.
 */
export function validateLocale(payload: Payload, value: string): string {
  const config = getLocaleConfig(payload);

  if (!config) {
    console.error(
      "Error: --locale was specified but this Payload instance has no localization configured."
    );
    process.exit(1);
  }

  if (value === "all") {
    return "all";
  }

  if (!config.locales.includes(value)) {
    console.error(`Error: Invalid locale "${value}".`);
    console.error(`Available locales: ${formatLocales(config)}`);
    process.exit(1);
  }

  return value;
}

/**
 * Parse --fallback-locale value.
 * "none" or "false" → false (disables fallback — untranslated fields return null).
 * A valid locale string → that string.
 * Validates against config.
 */
export function parseFallbackLocale(
  payload: Payload,
  value: string
): string | false {
  if (value === "none" || value === "false") {
    return false;
  }

  const config = getLocaleConfig(payload);

  if (!config) {
    console.error(
      "Error: --fallback-locale was specified but this Payload instance has no localization configured."
    );
    process.exit(1);
  }

  if (!config.locales.includes(value)) {
    console.error(`Error: Invalid fallback locale "${value}".`);
    console.error(`Available locales: ${formatLocales(config)}`);
    console.error(
      'Use "none" to disable fallback (untranslated fields return null).'
    );
    process.exit(1);
  }

  return value;
}

/**
 * Build locale args to spread into a Payload API call.
 * Returns an object with `locale` and/or `fallbackLocale` keys only if set.
 */
export function buildLocaleArgs(
  payload: Payload,
  flags: Record<string, string | undefined>
): Record<string, unknown> {
  const args: Record<string, unknown> = {};

  if (flags.locale) {
    args.locale = validateLocale(payload, flags.locale);
  }
  if (flags.fallbackLocale) {
    args.fallbackLocale = parseFallbackLocale(payload, flags.fallbackLocale);
  }

  return args;
}
