# Sutra design-system contracts

`styles/base/tokens.css` is the canonical token layer. New feature CSS should
use the `--sutra-*` spacing, type, semantic color, motion, safe-area, and control
tokens. Overlay code must use the documented `--z-*` ladder instead of adding a
new numeric z-index.

`styles/base/contracts.css` supplies global keyboard focus, coarse-pointer target
sizes, reduced-motion behavior, modal/toast layer mappings, standard empty,
loading, and error states, and bottom-navigation safe-area clearance. A feature
may opt out of the 44px coarse-pointer target only with the explicit
`sutra-allow-small-target` class and an accessible alternative.

Z-index order, low to high: content, sticky content, navigation, floating
actions, dropdowns, popovers, overlays, modals, toasts, recovery UI, and full
takeovers. Recovery and emergency-export controls must remain above optional
feature UI.
