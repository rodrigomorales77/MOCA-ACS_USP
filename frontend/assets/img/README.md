# Logo Assets

## Current Setup

The MOCA Automations logo is displayed in the header on the left side, next to the page title. The logo is positioned in a clean, non-intrusive manner with a subtle divider separating it from the title.

### Placeholder Logo

Currently using `moca-logo.svg` as a temporary placeholder. This SVG will display correctly at any size.

## Replacing with Actual Logo

To replace with the actual MOCA Automations logo image:

1. **Save your logo file** to this directory with one of these names:
   - `moca-logo.png` (recommended for PNG format)
   - `moca-logo.jpg` (for JPEG format)
   - Keep `moca-logo.svg` if using vector format

2. **Update the image reference** (if needed):
   - The header component references `assets/img/moca-logo.svg`
   - If you rename the file, update `frontend/assets/js/components/header.js` line 13

3. **Logo Styling**:
   - Maximum height: 24px (fits comfortably in 32px header)
   - Width: auto (maintains aspect ratio)
   - Maximum width: 120px
   - Styling defined in `frontend/assets/css/main.css`

## Logo Display Locations

- **Header (Primary)**: Left side of the top navigation bar
  - Clean placement next to page title
  - Visible on all pages
  - Non-intrusive and professional

## Tips for Best Results

- **PNG format**: Recommended if your logo has transparency
- **SVG format**: Best if you want perfect scaling at any resolution
- **Minimum dimensions**: At least 120px wide for clarity
- **Color**: Should work well on light backgrounds (matches current theme)

If the logo needs to be larger or repositioned, adjust the CSS in `main.css`:
- `.header-logo { height: 24px; }` - Change to increase/decrease size
- `.header-left { gap: 0.75rem; }` - Adjust spacing between logo and title
