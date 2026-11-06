/** Generated from tokens.json. Edit JSON then regenerate. */
export const tokens = {
  "meta": {
    "name": "MamNon App Design System",
    "version": "1.0.0",
    "date": "2026-10-17",
    "mode": "light",
    "sizeUnit": "logical px mapped to dp and sp on native",
    "sourceOfTruth": "tokens.json",
    "roles": [
      "parent",
      "teacher",
      "principal"
    ],
    "scope": "mobile apps; proposed implementation specification, not a running app"
  },
  "color": {
    "brand": "#168579",
    "action": "#11776D",
    "actionPressed": "#0D5E56",
    "brandSoft": "#E7F4F0",
    "background": "#F7F9F8",
    "surface": "#FFFFFF",
    "surfaceMuted": "#EFF4F2",
    "surfaceRaised": "#FFFFFF",
    "textPrimary": "#172D34",
    "textSecondary": "#52666E",
    "textTertiary": "#667980",
    "textOnAction": "#FFFFFF",
    "textDisabled": "#667980",
    "borderSubtle": "#DCE5E3",
    "borderControl": "#738C88",
    "borderFocus": "#168579",
    "divider": "#E5ECEA",
    "success": "#287246",
    "successSoft": "#EAF5ED",
    "warning": "#916000",
    "warningSoft": "#FFF4D9",
    "error": "#C13F36",
    "errorSoft": "#FDEEEB",
    "info": "#22669D",
    "infoSoft": "#EDF4FB",
    "disabledFill": "#E7ECEA",
    "overlay": "#172D348F"
  },
  "space": {
    "0": 0,
    "1": 4,
    "2": 8,
    "3": 12,
    "4": 16,
    "5": 20,
    "6": 24,
    "8": 32,
    "10": 40,
    "12": 48,
    "16": 64
  },
  "radius": {
    "xs": 4,
    "sm": 8,
    "md": 12,
    "lg": 16,
    "xl": 24,
    "pill": 999
  },
  "typography": {
    "display": {
      "size": 32,
      "lineHeight": 40,
      "weight": 700
    },
    "heading1": {
      "size": 28,
      "lineHeight": 36,
      "weight": 700
    },
    "heading2": {
      "size": 24,
      "lineHeight": 32,
      "weight": 700
    },
    "heading3": {
      "size": 20,
      "lineHeight": 28,
      "weight": 600
    },
    "title": {
      "size": 18,
      "lineHeight": 26,
      "weight": 600
    },
    "body": {
      "size": 16,
      "lineHeight": 24,
      "weight": 400
    },
    "bodyStrong": {
      "size": 16,
      "lineHeight": 24,
      "weight": 600
    },
    "bodySmall": {
      "size": 14,
      "lineHeight": 22,
      "weight": 400
    },
    "label": {
      "size": 14,
      "lineHeight": 20,
      "weight": 600
    },
    "button": {
      "size": 16,
      "lineHeight": 24,
      "weight": 600
    },
    "caption": {
      "size": 12,
      "lineHeight": 18,
      "weight": 400
    },
    "metric": {
      "size": 32,
      "lineHeight": 40,
      "weight": 700
    }
  },
  "fontFamily": {
    "ios": "system",
    "android": "system",
    "webPreview": "system-ui, -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif"
  },
  "size": {
    "buttonSm": 40,
    "buttonMd": 48,
    "buttonLg": 56,
    "touchMin": 48,
    "inputMin": 52,
    "textareaMin": 120,
    "appBarMin": 56,
    "bottomNavMin": 64,
    "iconSm": 16,
    "iconMd": 20,
    "iconLg": 24,
    "avatarSm": 32,
    "avatarMd": 40,
    "avatarLg": 56,
    "pagePadding": 24,
    "pagePaddingCompact": 16,
    "cardPadding": 16,
    "rowMin": 64,
    "badgeMin": 24
  },
  "stroke": {
    "hairline": 1,
    "focus": 2,
    "icon": 1.75
  },
  "motion": {
    "pressMs": 100,
    "fadeMs": 150,
    "sheetMs": 240,
    "navigationMs": 240,
    "reduceMotion": "Use instant transitions; preserve progress indicators"
  },
  "elevation": {
    "card": {
      "shadow": "none",
      "border": "borderSubtle"
    },
    "floating": {
      "offsetY": 4,
      "blur": 16,
      "color": "#172D3414"
    },
    "modal": {
      "offsetY": 8,
      "blur": 24,
      "color": "#172D3429"
    }
  },
  "layout": {
    "referenceWidth": 390,
    "testWidths": [
      320,
      360,
      390,
      430,
      600
    ],
    "maxContentWidth": 600,
    "safeArea": "runtime OS insets; never fixed screenshot coordinates",
    "grid": 4
  }
} as const;
export type AppRole = typeof tokens.meta.roles[number];
export type ColorToken = keyof typeof tokens.color;
