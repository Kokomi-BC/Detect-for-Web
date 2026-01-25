(function() {
    window.applyDynamicTheme = async function() {
        try {
            const response = await fetch('/api/public/theme');
            const data = await response.json();
            
            if (data.success && data.theme) {
                const theme = data.theme;
                const mode = document.documentElement.getAttribute('data-theme') || localStorage.getItem('theme') || 'light';
                const isDark = mode === 'dark';
                
                // Pick values based on current mode, fallback to legacy fields or defaults
                let primary, background;
                if (isDark) {
                    primary = theme.darkPrimary || theme.primary || '#4cc9f0';
                    background = theme.darkBackground || '#0f172a';
                } else {
                    primary = theme.lightPrimary || theme.primary || '#4361ee';
                    background = theme.lightBackground || theme.background || '#f3f4f6';
                }

                if (primary) {
                    document.documentElement.style.setProperty('--primary-color', primary);
                    // Generate a hover color: darker for light mode, lighter for dark mode
                    const hoverColor = adjustColor(primary, isDark ? 20 : -20);
                    document.documentElement.style.setProperty('--primary-hover', hoverColor);
                    
                    // Generate accent variables
                    const rgb = hexToRgb(primary);
                    if (rgb) {
                        document.documentElement.style.setProperty('--accent-light', `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, 0.15)`);
                        document.documentElement.style.setProperty('--accent-hover', `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, 0.25)`);
                        document.documentElement.style.setProperty('--shadow-accent', `0 4px 12px rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, 0.25)`);
                        document.documentElement.style.setProperty('--divider-color', `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, ${isDark ? 0.2 : 0.15})`);
                    }
                }
                
                if (background) {
                    document.documentElement.style.setProperty('--bg-main', background);
                    document.documentElement.style.setProperty('--bg-color', background);
                }
            }
        } catch (e) {
            console.error('Failed to apply dynamic theme:', e);
        }
    }

    function hexToRgb(hex) {
        var result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
        return result ? {
            r: parseInt(result[1], 16),
            g: parseInt(result[2], 16),
            b: parseInt(result[3], 16)
        } : null;
    }

    function adjustColor(hex, amt) {
        let usePound = false;
        if (hex[0] == "#") {
            hex = hex.slice(1);
            usePound = true;
        }
        let num = parseInt(hex, 16);
        let r = (num >> 16) + amt;
        if (r > 255) r = 255; else if (r < 0) r = 0;
        let b = ((num >> 8) & 0x00FF) + amt;
        if (b > 255) b = 255; else if (b < 0) b = 0;
        let g = (num & 0x0000FF) + amt;
        if (g > 255) g = 255; else if (g < 0) g = 0;
        return (usePound ? "#" : "") + (g | (b << 8) | (r << 16)).toString(16).padStart(6, '0');
    }

    // Run as soon as possible
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', window.applyDynamicTheme);
    } else {
        window.applyDynamicTheme();
    }
})();
