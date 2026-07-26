# Frontend Application Documentation 

## Overview
This is a modern React 19 frontend application built with TypeScript, Tailwind CSS, and Rsbuild. It serves as a landing page for the ThinkCocoa project.

## Setup instructions
Make sure [pnpm](https://pnpm.io/) is installed:
```bash
npm i -g pnpm
```

Then install and start:
```bash
pnpm install
pnpm dev
```

### Available Scripts
```bash
pnpm dev      # Start development server (port 3000)
pnpm build    # Build for production
pnpm preview  # Preview production build
```


## Tech Stack

### Core Dependencies
- **React**: v19.0.0 - UI library with latest features
- **React DOM**: v19.0.0 - DOM rendering for React
- **TypeScript**: v5.7.2 - Type-safe JavaScript

### Build Tools
- **Rsbuild**: v1.1.0 — Modern, fast bundler built on Rspack, used for development and production builds
- **@rsbuild/plugin-react**: v1.1.0 — Adds zero-config React (and JSX) support to Rsbuild
- **@rsbuild/plugin-svgr**: v1.1.0 — Enables importing SVGs as React components with SVGR

### Styling
- **Tailwind CSS**: v3.4.15 - Utility-first CSS framework
- **PostCSS**: v8.4.49 - CSS processing
- **Autoprefixer**: v10.4.20 - Automatic vendor prefixing

## Project Structure

```
apps/fe/
├── src/
│   ├── App.tsx                 # Main React application component
│   ├── index.tsx               # Entry point: renders <App />
│   ├── index.css               # Global styles (Tailwind + resets)
│   └── env.d.ts                # TypeScript env definitions
├── public/
│   ├── inject-web-component.js # Standalone loader for web component assets
│   └── test-web-component.html # Manual test page for <wishlist-dock>
├── dist/
│   ├── inject-web-component.js # Build output: loader script
│   └── test-web-component.html # Build output: test HTML
├── rsbuild.config.ts           # Rsbuild build/dev config
├── tailwind.config.js          # Tailwind setup/config
├── postcss.config.js           # PostCSS config
├── tsconfig.json               # TypeScript config
└── package.json                # Dependencies, scripts, metadata
```

## Styling Approach

This project uses Tailwind and a design system inspired by [`Apple’s “Liquid Glass”`](https://developer-apple-com.translate.goog/documentation/TechnologyOverviews/liquid-glass?_x_tr_sl=en&_x_tr_tl=vi&_x_tr_hl=vi&_x_tr_pto=tc&_x_tr_hist=true) UI—prioritizing translucent panels, blurred backgrounds, and layered, glassy interfaces for a modern, elegant appearance.

## Backend Integration

API types are automatically generated from the backend's OpenAPI (Swagger) schema. I use `jsdoc` and `openapi-typescript` to keep backend and frontend type definitions synchronized, ensuring type safety and reducing manual maintenance. This enables seamless and reliable data contracts between the frontend and backend.

## How to embed the widget `<wishlist-dock>`

> For security reasons, your domain must be granted access to resources on my domain in order to embed the <wishlist-dock> web component on your site.

- I have developed a web component that uses Shadow DOM in "closed" mode, the most security mode of web component, that outside cannot get shadow DOM inside web componsnt 
- It allowing styles to be fully isolated from the host page. This means you can freely embed the `<wishlist-dock>` widget into different websites without worrying about style conflicts between the widget and the host site. **
1. **Copy these lines into your HTML:**

```html
<!-- web compponent tag -->
<wishlist-dock theme="dark"></wishlist-dock>
<!-- my injection script to boostrap web component -->
<script defer src="https://thinkcocoa.creativext.com/inject-web-component.js"></script>
```
  
2. **Example (for local testing):**

- Open [`http://localhost:3000/test-web-component.html`](http://localhost:3000/test-web-component.html) in your browser to see how it works.

**That's it!**  
No build tools or frameworks are required to embed the wishlist dock widget—just copy and paste as shown above.

### Architecture decisions & Trade-offs you made
- Isolate Css with shadow mode = close to prevent css conflict. It's very convenience but it's very complicated and take more effort to implement

## Improve if have more time
- add more features: share on Social networks
- add more common components in style `liquid-glass` to standalize components 
- add more unit test for increase test coverage
- add integration test
- prefetch images / assets to reduce loading time
- add more loading state, error state, validation on form
