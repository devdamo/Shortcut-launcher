# Application Icons

This directory should contain the application icons for different platforms.

## Required Icons

### Windows
- **icon.ico** - Windows icon file (256x256 or higher recommended)
  - Should contain multiple sizes: 16x16, 32x32, 48x48, 256x256
  - Use a tool like [IcoFX](https://icofx.ro/) or [GIMP](https://www.gimp.org/) to create

### macOS
- **icon.icns** - macOS icon file
  - Should contain multiple sizes from 16x16 to 1024x1024
  - Use [Image2icon](https://apps.apple.com/app/image2icon/id992115977) or `iconutil` command-line tool

### Linux
- **icon.png** - Linux icon file (512x512 or 1024x1024 recommended)
  - PNG format with transparency

## Creating Icons

If you don't have custom icons yet, you can:

1. **Use a simple design tool** like [Canva](https://www.canva.com) or [Figma](https://www.figma.com) to create a logo
2. **Generate from a PNG**:
   - Start with a high-resolution PNG (1024x1024)
   - Use [CloudConvert](https://cloudconvert.com) to convert to .ico and .icns
3. **Use icon generators**:
   - [electron-icon-builder](https://www.npmjs.com/package/electron-icon-builder)
   - [electron-icon-maker](https://www.npmjs.com/package/electron-icon-maker)

## Temporary Solution

Until you create custom icons, you can use placeholder icons:

```bash
# Install icon generator
npm install -g electron-icon-builder

# Generate icons from a single PNG (place a 1024x1024 PNG as source.png)
electron-icon-builder --input=source.png --output=assets
```

## Icon Design Tips

- Use a simple, recognizable design
- Ensure it looks good at small sizes (16x16)
- Use high contrast colors
- Avoid text in icons (hard to read at small sizes)
- Test on both light and dark backgrounds
