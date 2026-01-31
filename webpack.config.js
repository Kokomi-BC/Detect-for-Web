const path = require('path');
const HtmlWebpackPlugin = require('html-webpack-plugin');
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
  entry: {},
  output: {
    path: path.join(__dirname, 'dist'),
    filename: '[name].[contenthash:8].js',
    clean: true, // 构建前清理 dist
  },
  cache: isProduction ? { type: 'filesystem' } : false,
  optimization: {
    minimize: isProduction,
    splitChunks: {
      chunks: 'all',
    },
  },
  plugins: [
    new HtmlWebpackPlugin({
      template: path.join(__dirname, 'public/Main.html'),
      filename: 'Main.html',
      cache: false,
      minify: minifyOptions,
    }),
    new HtmlWebpackPlugin({
      template: path.join(__dirname, 'public/Welcome.html'),
      filename: 'Welcome.html',
      cache: false,
      minify: minifyOptions,
    }),
    new HtmlWebpackPlugin({
      template: path.join(__dirname, 'public/Login.html'),
      filename: 'Login.html',
      cache: false,
      minify: minifyOptions,
    }),
    new HtmlWebpackPlugin({
      template: path.join(__dirname, 'public/Admin.html'),
      filename: 'Admin.html',
      cache: false,
      minify: minifyOptions,
    }),
    new HtmlWebpackPlugin({
      template: path.join(__dirname, 'public/Mobile.html'),
      filename: 'Mobile.html',
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