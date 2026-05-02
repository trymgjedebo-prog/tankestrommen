/** @type {import('next').NextConfig} */
const nextConfig = {
  serverExternalPackages: ["pdf-parse", "mammoth", "pdfjs-dist", "canvas", "jszip"],
};

export default nextConfig;
