# Pinned by Task 1 and re-verified by digest — do NOT float this tag. The
# `playwright` npm package installed below must stay at the SAME version,
# because the browser builds baked into this image (chromium-1234) are the
# ones that version expects to find under /ms-playwright.
FROM mcr.microsoft.com/playwright:v1.62.1-noble@sha256:dcc5531e97840b9b5e794f2814476b21571c5124a3fca2267d73041f56e7580e

WORKDIR /app

# Fonts first: the export HTML carries its font stack BY NAME, so a missing
# face renders tofu rather than failing.
#
# Pretendard comes from node_modules, where it is already a dependency of the
# web app. It ships a .ttf under dist/public/variable and NO .woff2 there (the
# .woff2 files under dist/web/... are dynamic subsets, useless here).
#
# JetBrains Mono does NOT come from node_modules, and that is a deliberate
# reversal of the obvious approach. @fontsource-variable ships .woff2 only.
# fontconfig indexes .woff2 quite happily — FreeType 2.13 in this image reads
# it — but CHROMIUM DOES NOT ACCEPT WOFF2 AS A SYSTEM FONT: measured on
# 2026-08-25, a code block requesting the family rendered in
# WenQuanYiZenHeiMono while `fc-match` reported JetBrains Mono. The distro
# package ships real TTFs and is the only version of this that works.
RUN apt-get update -qq && \
    apt-get install -y --no-install-recommends fonts-jetbrains-mono && \
    rm -rf /var/lib/apt/lists/*

COPY node_modules/pretendard/dist/public/variable/PretendardVariable.ttf /usr/share/fonts/markflowing/
COPY server/docker/pdf/fonts.conf /etc/fonts/conf.d/99-markflowing.conf
RUN fc-cache -f > /dev/null

# No tsx: node 24 strips types natively, and `erasableSyntaxOnly` in the
# tsconfig is what guarantees these files contain nothing it cannot strip.
# One fewer dependency, and one fewer thing to keep in step with the host.
RUN npm install --no-save --omit=dev playwright@1.62.1 > /dev/null

COPY server/pdf ./server/pdf
COPY server/docker/pdf/verify-fonts.mjs ./

# Chromium refuses to start as root without --no-sandbox, and turning the
# sandbox off in the one service that renders attacker-supplied HTML would
# undo the point of the sandbox. pwuser ships with the base image.
USER pwuser

# The build FAILS if either family is not actually embedded in a rendered PDF.
# This runs AFTER `USER pwuser` on purpose: it proves the fonts resolve for the
# user the service actually runs as, not for root.
RUN node verify-fonts.mjs

ENV NODE_ENV=production
EXPOSE 8788
CMD ["node", "server/pdf/main.ts"]
