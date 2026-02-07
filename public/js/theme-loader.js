(function() {
    window.renderTheme = function(theme) {
        if (!theme) return;
        const mode = document.documentElement.getAttribute('data-theme') || localStorage.getItem('theme') || 'light';
        const isDark = mode === 'dark';
        
        let primary, secondary, background, card, bgSec, border, glassBorder, textMain, textMuted, bgTertiary, bgMenu;
        if (isDark) {
            primary = theme.darkPrimary || theme.primary || '#4cc9f0';
            secondary = theme.darkSecondary || '#4895ef';
            background = theme.darkBackground || '#0f172a';
            card = theme.darkCard || '#1e293b';
            bgSec = theme.darkBgSec || '#1a1d20';
            border = theme.darkBorder || '#343333';
            glassBorder = theme.darkGlassBorder || 'rgba(255, 255, 255, 0.15)';
            textMain = theme.darkTextMain || '#f8fafc';
            textMuted = theme.darkTextMuted || '#94a3b8';
            bgTertiary = theme.darkBgTertiary || '#212529';
            bgMenu = theme.darkBgMenu || 'rgba(25, 25, 26, 0.95)';
        } else {
            primary = theme.lightPrimary || theme.primary || '#4361ee';
            secondary = theme.lightSecondary || '#3f37c9';
            background = theme.lightBackground || theme.background || '#f3f4f6';
            card = theme.lightCard || '#ffffff';
            bgSec = theme.lightBgSec || '#f8f9fa';
            border = theme.lightBorder || '#e9ecef';
            glassBorder = theme.lightGlassBorder || 'rgba(255, 255, 255, 0.8)';
            textMain = theme.lightTextMain || '#111827';
            textMuted = theme.lightTextMuted || '#6b7280';
            bgTertiary = theme.lightBgTertiary || '#f1f3f5';
            bgMenu = theme.lightBgMenu || 'rgba(255, 255, 255, 0.95)';
        }

        if (primary) {
            document.documentElement.style.setProperty('--primary-color', primary);
            document.documentElement.style.setProperty('--accent-color', primary);
            
            const rgb = hexToRgb(primary);
            if (rgb) {
                document.documentElement.style.setProperty('--accent-light', `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, 0.15)`);
                document.documentElement.style.setProperty('--accent-hover', `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, 0.25)`);
                document.documentElement.style.setProperty('--shadow-accent', `0 4px 12px rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, 0.25)`);
                document.documentElement.style.setProperty('--divider-color', `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, ${isDark ? 0.2 : 0.15})`);
            }
            
            const hover = adjustColor(primary, isDark ? 20 : -20);
            document.documentElement.style.setProperty('--primary-hover', hover);
        }

        if (secondary) {
            document.documentElement.style.setProperty('--secondary-color', secondary);
            
            const rgb = hexToRgb(secondary);
            if (rgb) {
                document.documentElement.style.setProperty('--secondary-light', `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, 0.15)`);
                document.documentElement.style.setProperty('--secondary-hover', `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, 0.25)`);
            }
        }
        
        if (background) {
            document.documentElement.style.setProperty('--bg-main', background);
            document.documentElement.style.setProperty('--bg-color', background);
            
            const rgb = hexToRgb(background);
            if (rgb) {
                document.documentElement.style.setProperty('--bg-glass', `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, ${isDark ? 0.6 : 0.45})`);
            }
        }

        if (bgSec) {
            document.documentElement.style.setProperty('--bg-secondary', bgSec);
        }

        if (border) {
            document.documentElement.style.setProperty('--border-color', border);
        }

        if (glassBorder) {
            document.documentElement.style.setProperty('--glass-border', glassBorder);
        }

        if (textMain) {
            document.documentElement.style.setProperty('--text-main', textMain);
        }

        if (textMuted) {
            document.documentElement.style.setProperty('--text-muted', textMuted);
        }

        if (bgTertiary) {
            document.documentElement.style.setProperty('--bg-tertiary', bgTertiary);
        }

        if (bgMenu) {
            document.documentElement.style.setProperty('--bg-menu', bgMenu);
        }

        if (card) {
            document.documentElement.style.setProperty('--bg-card', card);
            document.documentElement.style.setProperty('--card-bg', card);
            document.documentElement.style.setProperty('--bg-card-solid', card);
            document.documentElement.style.setProperty('--bg-primary', card); 
        }
    };

    window.applyDynamicTheme = async function(force = false) {
        try {
            if (!force) {
                const cachedData = localStorage.getItem('dynamic_theme_cache');
                if (cachedData) {
                    const { theme, timestamp } = JSON.parse(cachedData);
                    renderTheme(theme);
                    // Cache for 2 minutes to keep it relatively fresh but avoid spam
                    if (Date.now() - timestamp < 120 * 1000) return;
                }
            }

            const response = await fetch('/api/public/theme');
            const data = await response.json();
            
            if (data.status !== 'fail' && data.theme) {
                localStorage.setItem('dynamic_theme_cache', JSON.stringify({
                    theme: data.theme,
                    timestamp: Date.now()
                }));
                renderTheme(data.theme);
            }
        } catch (e) {
            console.error('Failed to apply dynamic theme:', e);
        }
    }

    window.hexToRgb = function(hex) {
        if (!hex || typeof hex !== 'string') return null;
        if (hex.startsWith('rgba') || hex.startsWith('rgb')) {
            const match = hex.match(/\d+/g);
            return match ? { r: parseInt(match[0]), g: parseInt(match[1]), b: parseInt(match[2]) } : null;
        }
        var result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
        return result ? {
            r: parseInt(result[1], 16),
            g: parseInt(result[2], 16),
            b: parseInt(result[3], 16)
        } : null;
    }

    window.adjustColor = function(hex, amt) {
        if (!hex || typeof hex !== 'string' || !hex.startsWith('#')) return hex;
        let usePound = true;
        let color = hex.slice(1);
        let num = parseInt(color, 16);
        let r = (num >> 16) + amt;
        if (r > 255) r = 255; else if (r < 0) r = 0;
        let b = ((num >> 8) & 0x00FF) + amt;
        if (b > 255) b = 255; else if (b < 0) b = 0;
        let g = (num & 0x0000FF) + amt;
        if (g > 255) g = 255; else if (g < 0) g = 0;
        return "#" + (g | (b << 8) | (r << 16)).toString(16).padStart(6, '0');
    }

    // Run as soon as possible
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', window.applyDynamicTheme);
    } else {
        window.applyDynamicTheme();
    }
})();
