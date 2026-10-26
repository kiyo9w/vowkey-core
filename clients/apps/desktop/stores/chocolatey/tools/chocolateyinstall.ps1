$ErrorActionPreference = 'Stop';

$url = 'https://github.com/bitwarden/clients/releases/download/desktop-v__version__/__artifact_prefix__Vowkey-Installer-__version__.exe'
$checksum = '__checksum__'

$packageArgs = @{
  packageName   = 'vowkey'
  fileType      = 'EXE'
  softwareName  = 'Vowkey'
  url           = $url
  checksum      = $checksum
  checksumType  = 'sha256'
  silentArgs    = '/S'
  validExitCodes= @(0)
}

Install-ChocolateyPackage @packageArgs
