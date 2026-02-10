const path = require('path');
const HtmlWebpackPlugin = require('html-webpack-plugin');
const MiniCssExtractPlugin = require('mini-css-extract-plugin');
const CssMinimizerPlugin = require('css-minimizer-webpack-plugin');
const webpack = require('webpack');

const isProduction = process.env.NODE_ENV === 'production' || process.argv.includes('production');

const minifyOptions = isProduction ? {
  removeComments: true,
  collapseWhitespace: true,
  removeRedundantAttributes: true,
  useShortDoctype: true,
  removeEmptyAttributes: true,
  removeStyleLinkTypeAttributes: true,
  keepClosingSlash: true,
  minifyJS: true,
  minifyCSS: true,
  minifyURLs: true,
} : false;

module.exports = {
  mode: isProduction ? 'production' : 'development',
  entry: {
    main: [
      './public/js/theme-loader.js',
      './public/js/user-editor.js',
      './public/js/export-manager.js',
      './public/css/variables.css',
      './public/css/common.css',
      './public/css/main.css'
    ],
    admin: [
      './public/js/theme-loader.js',
      './public/js/user-editor.js',
      './public/js/admin.js',
      './public/css/variables.css',
      './public/css/common.css',
      './public/css/admin.css'
    ],
    login: [
      './public/css/variables.css',
      './public/css/common.css',
      './public/css/login.css'
    ],
    welcome: [
      './public/js/theme-loader.js',
      './public/css/variables.css',
      './public/css/common.css',
      './public/css/welcome.css' 
    ],
    mobile: [
      './public/js/theme-loader.js',
      './public/js/user-editor.js',
      './public/js/mobile.js',
      './public/css/variables.css',
      './public/css/common.css',
      './public/css/mobile.css'
    ]
  },
  output: {
    path: path.join(__dirname, 'dist'),
    filename: 'js/[name].[contenthash:8].js',
    clean: true,
  },
  cache: { type: 'filesystem' },
  module: {
    rules: [
      {
        test: /\.css$/i,
        use: [
          isProduction ? MiniCssExtractPlugin.loader : 'style-loader',
          'css-loader',
          'postcss-loader',
        ],
      },
    ],
  },
  optimization: {
    minimize: isProduction,
    minimizer: [
      `...`,
      new CssMinimizerPlugin(),
    ],
    splitChunks: {
      chunks: 'all',
    },
  },
  plugins: [
    new MiniCssExtractPlugin({
      filename: 'css/[name].[contenthash:8].css',
    }),
    new HtmlWebpackPlugin({
      template: path.join(__dirname, 'public/Main.html'),
      filename: 'Main.html',
      chunks: ['main'],
      cache: false,
      minify: minifyOptions,
    }),
    new HtmlWebpackPlugin({
      template: path.join(__dirname, 'public/Welcome.html'),
      filename: 'Welcome.html',
      chunks: ['welcome'],
      cache: false,
      minify: minifyOptions,
    }),
    new HtmlWebpackPlugin({
      template: path.join(__dirname, 'public/Login.html'),
      filename: 'Login.html',
      chunks: ['login'],
      cache: false,
      minify: minifyOptions,
    }),
    new HtmlWebpackPlugin({
      template: path.join(__dirname, 'public/Admin.html'),
      filename: 'Admin.html',
      chunks: ['admin'],
      cache: false,
      minify: minifyOptions,
    }),
    new HtmlWebpackPlugin({
      template: path.join(__dirname, 'public/Mobile.html'),
      filename: 'Mobile.html',
      chunks: ['mobile'],
      cache: false,
      minify: minifyOptions,
    }),
    new webpack.DefinePlugin({
      'global': 'global',
      'process.env.NODE_ENV': JSON.stringify(isProduction ? 'production' : 'development'),
    }),
  ],
  devServer: {
    static: {
      directory: path.join(__dirname, 'public'),
    },
    port: 8080,
    hot: true,
    historyApiFallback: {
      index: 'Main.html',
    },
  },
  target: 'web',
  node: {
    global: true,
  },
};