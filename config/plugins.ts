module.exports = ({ env }) => ({
 'transformer': {
    enabled: true,
    config: {
      responseTransforms: {
        removeAttributesKey: true,
        removeDataKey: true,
      },
      requestTransforms : {
        wrapBodyWithDataKey: true
      },
    }
  },
  email: {
		config: {
		  provider: 'nodemailer',
		  providerOptions: {
        host: 'sandbox.smtp.mailtrap.io',
        port: 2525,
        auth: {
          user: 'b249af88137354',
          pass: '5004844beadab0',
        },
        ignoreTLS: false,
		  },
		  settings: {
        defaultFrom: 'info@shoes.com',
        defaultReplyTo: 'info@shoes.com',
		  },
		},
	},
});