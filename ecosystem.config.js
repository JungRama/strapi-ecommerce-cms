module.exports = {
	apps: [
		{
			name: 'strapi-sneakpeaks',
			script: 'npm',
			args: 'start',
		},
	],
	env_production: {
		NODE_ENV: 'production',
		PORT: '3001',
	},
	env_development: {
		NODE_ENV: 'production',
		PORT: '3000',
	},
}
