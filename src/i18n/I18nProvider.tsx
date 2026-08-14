// ==========================================
// I18N PROVIDER
// ==========================================
//
// - Loads the persisted language (localStorage) synchronously so the
//   very first render is already in the right language.
// - Exposes `t()` for translations and `setLang()` for the switcher.
// - Syncs `document.documentElement` `lang` + `dir` attributes so
//   Mantine's logical CSS props and the app flip to RTL for Urdu.
// - Applies an Urdu-aware font fallback for RTL mode.

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

import {
  LANGUAGES,
  LANG_STORAGE_KEY,
  translations,
  type Lang,
} from "./translations";

type I18nContextValue = {
  lang: Lang;
  dir: "ltr" | "rtl";
  t: (key: string, params?: Record<string, string | number>) => string;
  setLang: (lang: Lang) => void;
};

const I18nCtx = createContext<I18nContextValue | null>(null);

function loadInitialLang(): Lang {
  try {
    const stored = localStorage.getItem(LANG_STORAGE_KEY);
    if (stored === "en" || stored === "ur") return stored;
  } catch {
    // localStorage unavailable — fall through to default
  }
  return "en";
}

export function I18nProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<Lang>(loadInitialLang);
  const dir = LANGUAGES[lang].dir;

  useEffect(() => {
    try {
      localStorage.setItem(LANG_STORAGE_KEY, lang);
    } catch {
      // non-persistable environment — no problem
    }
    document.documentElement.lang = lang === "ur" ? "ur" : "en";
    document.documentElement.dir = dir;
  }, [lang, dir]);

  const setLang = useCallback((next: Lang) => {
    setLangState(next);
  }, []);

  const t = useCallback(
    (key: string, params?: Record<string, string | number>) => {
      return translations[lang] && key in translations[lang]
        ? applyParams(translations[lang][key], params)
        : applyParams(key in translations.en ? translations.en[key] : key, params);
    },
    [lang],
  );

  const value = useMemo<I18nContextValue>(
    () => ({ lang, dir, t, setLang }),
    [lang, dir, t, setLang],
  );

  return <I18nCtx.Provider value={value}>{children}</I18nCtx.Provider>;
}

function applyParams(
  str: string,
  params?: Record<string, string | number>,
): string {
  if (!params) return str;
  let out = str;
  for (const [k, v] of Object.entries(params)) {
    out = out.split(`{${k}}`).join(String(v));
  }
  return out;
}

export function useI18n(): I18nContextValue {
  const ctx = useContext(I18nCtx);
  if (!ctx) throw new Error("useI18n must be used inside I18nProvider");
  return ctx;
}
