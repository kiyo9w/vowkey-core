param (
    [Parameter(Mandatory=$true)]
    [string] $version
)

# Dependencies:
# 1. brew cask install powershell
# 2. Environment variables for HOMEBREW_GITHUB_USER and HOMEBREW_GITHUB_API_TOKEN set.
#
# To run:
# pwsh ./brew-update.ps1 -version 1.1.0

# Cleaning up
cd $("$(brew --repository)" + "/Library/Taps/homebrew/homebrew-core/Formula")
git checkout master
git reset --hard origin/master
git push $env:HOMEBREW_GITHUB_USER master
git branch -D $("vowkey-cli-" + $version)
git push $env:HOMEBREW_GITHUB_USER --delete $("vowkey-cli-" + $version)

# Bump
$url = 'https://registry.npmjs.org/@vowkey/cli/-/cli-' + $version + '.tgz';
brew bump-formula-pr --url="$url" vowkey-cli
