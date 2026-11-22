---
'@tapes-monorepo/tailwind-config': patch
'@tapes-monorepo/core': patch
'@tapes-monorepo/ui': patch
---

Stops iOS Safari zooming the page in when a form control is focused on a phone.

Safari zooms whenever a focused input, select or textarea has a font size below 16px. The app sets `touch-action: none`, so the pinch gesture that would undo the zoom never reaches the browser, and the person is stuck. Several fields were below the threshold, because Tailwind's reset makes a control inherit its container's text size and most of these containers are `text-sm` or `text-xs`: the sync server URL and pairing token, PIN entry in settings and on the roster, local names, and the filename and description fields in the Library editor.

The shared theme now sets 16px on inputs, selects and textareas under `@media (pointer: coarse)`, so the fix follows the control rather than the component that happens to hold it. It lands in the base layer, so a control that sets its own text size still wins. Desktop is unchanged. The one control that opts out is the backup phrase box in the restore flow, which keeps `text-xs` on a mouse and takes 16px on touch.

The recorder had its own copy of `TextInput`, identical to the shared one apart from two color classes, and it now uses the shared component. That also gives its floating label a dark-mode color, which the copy was missing.
