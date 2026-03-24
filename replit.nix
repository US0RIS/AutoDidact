{ pkgs }: {
  deps = [
    pkgs.nodejs_20
    pkgs.chromium
    pkgs.nss
    pkgs.at-spi2-atk
    pkgs.cups
    pkgs.libdrm
    pkgs.mesa
    pkgs.xorg.libX11
    pkgs.xorg.libXcomposite
    pkgs.xorg.libXdamage
    pkgs.xorg.libXext
    pkgs.xorg.libXfixes
    pkgs.xorg.libXrandr
    pkgs.xorg.libxcb
    pkgs.pango
    pkgs.cairo
    pkgs.alsa-lib
    pkgs.dbus
    pkgs.gtk3
    pkgs.glib
    pkgs.nspr
    pkgs.expat
  ];

  env = {
    PLAYWRIGHT_BROWSERS_PATH = "0";
    PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH = "${pkgs.chromium}/bin/chromium";
  };
}
