const purgecss = require('postcss-purgecss');
const cssnano = require('cssnano');

module.exports = {
  plugins: [
    purgecss({
      content: ['./public/**/*.html', './public/**/*.js', './src/**/*.js'],
      defaultExtractor: content => content.match(/[\w-/:]+(?<!:)/g) || [],
      safelist: {
        standard: [/^data-theme/, /^show/, /^active/, /^modal/, /^toast/],
        deep: [/^user-dropdown/, /^pagination/],
      }
    }),
    cssnano({
      preset: 'default',
    }),
  ],
};
