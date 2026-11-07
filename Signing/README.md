# iumrah Root — signing

Never store private keys or provisioning profiles in Git.
Use ROOT_DISTRIBUTION_KEY_B64 and ROOT_IOS_PROFILE_B64 GitHub Actions secrets.
The encrypted private key must match the certificate inside the NEW Team profile.
The decrypt password is IOS_SIGNING_KEY_PASSWORD from the original CSR workflow run.
Do not regenerate the CSR without reissuing the distribution certificate/profile.
