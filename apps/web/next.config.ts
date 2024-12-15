import { NextConfig } from 'next'

const nextConfig: NextConfig = {
  // output: 'export',
  webpack: (config) => {
    config.module.generator = {
      ...config.module.generator,
      asset: {},
    }
    return config
  },
}

export default nextConfig
