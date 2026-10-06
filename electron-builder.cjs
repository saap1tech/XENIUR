module.exports = {
  appId: 'org.xeniur.desktop', productName: 'XENIUR',
  directories: {output:'release', buildResources:'brand/icons'},
  artifactName:'XENIUR-${version}-${os}-${arch}.${ext}',
  files:['apps/desktop/out/**/*','package.json','LICENSE','THIRD_PARTY_NOTICES.md'],
  extraResources:[
    {from:'config',to:'config'}, {from:'brand',to:'brand'},
    {from:'blender',to:'blender',filter:['**/*']},
  ],
  asar:true, asarUnpack:['**/*.node','**/tesseract.js/**','**/tesseract.js-core/**','**/@tesseract.js-data/**','**/pdfjs-dist/**'],
  npmRebuild:false,
  mac:{category:'public.app-category.productivity',icon:'brand/icons/icon.icns',target:['dmg','zip'],hardenedRuntime:true,notarize:!!process.env.APPLE_API_KEY},
  win:{icon:'brand/icons/icon.ico',target:['nsis'],verifyUpdateCodeSignature:true},
  nsis:{oneClick:false,allowToChangeInstallationDirectory:true,createDesktopShortcut:true},
  linux:{icon:'brand/icons/icon.png',category:'Office',target:['AppImage','deb']},
  publish:null,
};
