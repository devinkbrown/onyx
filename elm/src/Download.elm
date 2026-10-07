module Download exposing
    ( ActiveLane(..)
    , Availability(..)
    , CatalogLane
    , CatalogState(..)
    , DownloadCard
    , DownloadCatalog
    , decodeCatalog
    , MacosArch
    , activeLaneId
    , activeLanes
    , archiveButtonLabel
    , availabilityLabel
    , catalogReceipt
    , checksumFromCatalog
    , checksumKeyForLane
    , downloadAvailability
    , downloadCards
    , downloadCatalogUrl
    , installSteps
    , isActiveLane
    , laneFromString
    , macosCard
    , packageRootName
    , parseSha256SumText
    , productVersion
    , signingLabel
    , verifyPreBlock
    )

{-| Pure core of the public Download surface (1:1 with
`src/routes/downloadMeta.ts`).

Active native package cards (4): Windows zip, Linux/FreeBSD/OpenBSD tar.gz.
macOS Intel + Apple Silicon are a combined coming-soon surface until
genuine Darwin builds ship — never fabricate DMGs on Linux.

Asset basenames for active lanes stay aligned with
`tools/release-windows.mjs` + `tools/release-unix.mjs` +
`tools/stage-release-downloads.mjs`. Checksums load from staged
`/downloads/v0.1.3/*.sha256` or `catalog.json` when present — never
invented in the SPA.

-}

import Json.Decode as Decode exposing (Decoder)


{-| Download product version pinned by the oracle.
-}
productVersion : String
productVersion =
    "0.1.3"


{-| Lanes that currently offer a real archive download on this site.
-}
type ActiveLane
    = Windows
    | Linux
    | FreeBSD
    | OpenBSD


{-| A lane token from the catalog JSON (may be an unknown string).
-}
laneFromString : String -> Maybe ActiveLane
laneFromString raw =
    case raw of
        "windows" ->
            Just Windows

        "linux" ->
            Just Linux

        "freebsd" ->
            Just FreeBSD

        "openbsd" ->
            Just OpenBSD

        _ ->
            Nothing


{-| True for the four active archive lanes; macOS lanes are coming-soon.
-}
isActiveLane : String -> Bool
isActiveLane raw =
    laneFromString raw /= Nothing


activeLaneId : ActiveLane -> String
activeLaneId lane =
    case lane of
        Windows ->
            "windows"

        Linux ->
            "linux"

        FreeBSD ->
            "freebsd"

        OpenBSD ->
            "openbsd"


activeLanes : List ActiveLane
activeLanes =
    [ Windows, Linux, FreeBSD, OpenBSD ]


type alias DownloadCard =
    { lane : ActiveLane
    , osLabel : String
    , arch : String
    , title : String
    , summary : String
    , primaryPackages : List String
    , packageManager : Maybe String
    , archiveExt : String
    , archiveName : String
    , archiveUrl : String
    , sha256Url : String
    , noticeUrl : String
    , hasInstallScript : Bool
    , runtimeIncluded : Bool
    }


type alias MacosArch =
    { id : String
    , label : String
    , arch : String
    , note : String
    }


type alias MacosCard =
    { osLabel : String
    , title : String
    , summary : String
    , statusLabel : String
    , arches : List MacosArch
    , runtime : String
    , plannedPackage : String
    , honesty : String
    }


publicDir : String
publicDir =
    "/downloads/v" ++ productVersion


{-| Basename without extension — must match `release-*.mjs` exactly for
active lanes. macOS basenames stay documented for future Darwin staging
(not linked in UI).
-}
assetBase : ActiveLane -> String
assetBase lane =
    "onyx-" ++ productVersion ++ "-" ++ activeLaneId lane ++ "-x86_64-ReleaseFast-unsigned"


makeCard :
    ActiveLane
    -> String
    -> String
    -> String
    -> List String
    -> Maybe String
    -> String
    -> Bool
    -> Bool
    -> DownloadCard
makeCard lane osLabel title summary primaryPackages packageManager archiveExt hasInstallScript runtimeIncluded =
    let
        base =
            assetBase lane

        archiveName =
            base ++ "." ++ archiveExt
    in
    { lane = lane
    , osLabel = osLabel
    , arch = "x86_64"
    , title = title
    , summary = summary
    , primaryPackages = primaryPackages
    , packageManager = packageManager
    , archiveExt = archiveExt
    , archiveName = archiveName
    , archiveUrl = publicDir ++ "/" ++ archiveName
    , sha256Url = publicDir ++ "/" ++ base ++ ".sha256"
    , noticeUrl = publicDir ++ "/" ++ base ++ ".NOTICE.txt"
    , hasInstallScript = hasInstallScript
    , runtimeIncluded = runtimeIncluded
    }


{-| Active public download cards in presentation order. macOS is
intentionally omitted — see `macosCard`.
-}
downloadCards : List DownloadCard
downloadCards =
    [ makeCard Windows
        "Windows"
        "Windows x86_64"
        "Native SDK directory package with the full offline Microsoft WebView2 x64 installer included. Extract once and use Install-and-Run-Onyx.cmd; Windows GUI launch is not claimed from this Linux release host."
        [ "WebView2 Evergreen Runtime (offline x64 installer)" ]
        Nothing
        "zip"
        False
        True
    , makeCard Linux
        "Linux"
        "Linux x86_64"
        "Native SDK system-WebView package with install.sh. It resolves GTK 4 + WebKitGTK 6 through apt, dnf, or pacman, then installs the client under your chosen prefix."
        [ "gtk4", "webkitgtk-6.0" ]
        (Just "apt, dnf, or pacman")
        "tar.gz"
        True
        False
    , makeCard FreeBSD
        "FreeBSD"
        "FreeBSD x86_64"
        "Zig-native GTK + WebKitGTK host with install.sh. One unsigned tar.gz; not a ports package. GUI launch not claimed from the Linux build host."
        [ "gtk4", "webkit2-gtk_60" ]
        (Just "pkg")
        "tar.gz"
        True
        False
    , makeCard OpenBSD
        "OpenBSD"
        "OpenBSD x86_64"
        "Zig-native GTK + WebKitGTK host with install.sh. One unsigned tar.gz; not an official port. GUI launch not claimed from the Linux build host."
        [ "gtk4", "webkitgtk60" ]
        (Just "pkg_add")
        "tar.gz"
        True
        False
    ]


{-| Combined macOS surface: Intel + Apple Silicon planned, no fake
download buttons. Native DMGs ship only after genuine matching-arch
Darwin builds (not fabricated here).
-}
macosCard : MacosCard
macosCard =
    { osLabel = "macOS"
    , title = "Mac — Intel & Apple Silicon"
    , summary = "Native SDK system WKWebView packages for Intel (x86_64) and Apple Silicon (arm64) are being prepared on real Macs. No DMG is published on this site yet — we will not link a fake or incomplete download."
    , statusLabel = "Coming soon"
    , arches =
        [ { id = "macos-x86_64"
          , label = "Intel x86_64"
          , arch = "x86_64"
          , note = "DMG built only on a genuine Darwin Intel runner when ready."
          }
        , { id = "macos-arm64"
          , label = "Apple Silicon arm64"
          , arch = "arm64"
          , note = "DMG built only on a genuine Darwin arm64 runner when ready."
          }
        ]
    , runtime = "system WKWebView"
    , plannedPackage = "unsigned, unnotarized .app inside a DMG (separate arch lanes)"
    , honesty = "Until macOS packages ship, use the browser. Supporting browsers can put Onyx on the Home Screen or in its own window. No store."
    }


{-| Top-level directory name inside the release archive (matches
`packageDirName`).
-}
packageRootName : ActiveLane -> String
packageRootName lane =
    case lane of
        Windows ->
            "onyx-" ++ productVersion ++ "-windows-ReleaseFast"

        Linux ->
            "onyx-" ++ productVersion ++ "-linux-ReleaseFast"

        FreeBSD ->
            "onyx-" ++ productVersion ++ "-freebsd-x86_64-ReleaseFast"

        OpenBSD ->
            "onyx-" ++ productVersion ++ "-openbsd-x86_64-ReleaseFast"


{-| Install steps for one lane (BSD surfaces share the `install.sh` shape).
-}
installSteps : ActiveLane -> List String
installSteps lane =
    let
        cardFor =
            downloadCards
                |> List.filter (\c -> c.lane == lane)
                |> List.head
    in
    case cardFor of
        Nothing ->
            []

        Just c ->
            let
                root =
                    packageRootName lane
            in
            case lane of
                Windows ->
                    [ "Expand-Archive " ++ c.archiveName ++ " -DestinationPath ."
                    , "cd " ++ root
                    , ".\\Install-and-Run-Onyx.cmd"
                    , "# Full offline WebView2 x64 installer is included under runtime/"
                    , "# Runtime / GUI launch is NOT verified on the Linux release host"
                    ]

                Linux ->
                    [ "tar xzf " ++ c.archiveName
                    , "cd " ++ root
                    , "./install.sh --help"
                    , "./install.sh                  # resolves runtime via apt/dnf/pacman"
                    , "./install.sh --prefix \"$HOME/.local\" --no-deps"
                    , "./install.sh --dry-run"
                    ]

                _ ->
                    let
                        pkgs =
                            String.join " " c.primaryPackages

                        pm =
                            Maybe.withDefault "" c.packageManager
                    in
                    [ "tar xzf " ++ c.archiveName
                    , "cd " ++ root
                    , "./install.sh --help"
                    , "./install.sh                  # PREFIX=/usr/local; may need root+network for " ++ pm ++ " " ++ pkgs
                    , "./install.sh --prefix \"$HOME/onyx-prefix\" --no-deps"
                    , "./install.sh --dry-run"
                    ]


downloadCatalogUrl : String
downloadCatalogUrl =
    publicDir ++ "/catalog.json"


{-| Parse a coreutils-style `sha256sum` body (hash + two spaces + name).
Takes the first non-blank line; the hash must be 64 hex chars.
-}
parseSha256SumText : String -> Maybe { hash : String, name : String }
parseSha256SumText text =
    let
        firstLine =
            text
                |> String.split "\n"
                |> List.map (String.trim >> String.replace "\u{000D}" "")
                |> List.filter (\l -> not (String.isEmpty l))
                |> List.head
    in
    case firstLine of
        Nothing ->
            Nothing

        Just line ->
            case String.indexes "  " line |> List.head of
                Just idx ->
                    let
                        hash =
                            String.left idx line

                        name =
                            String.dropLeft (idx + 2) line
                    in
                    if isHex64 hash && not (String.isEmpty name) then
                        Just { hash = String.toLower hash, name = name }

                    else
                        Nothing

                Nothing ->
                    Nothing


isHex64 : String -> Bool
isHex64 s =
    String.length s == 64 && String.all isHexChar s


isHexChar : Char -> Bool
isHexChar c =
    (c >= '0' && c <= '9')
        || (c >= 'a' && c <= 'f')
        || (c >= 'A' && c <= 'F')


type alias CatalogLane =
    { lane : String
    , present : Maybe Bool
    , sha256 : Maybe String
    , archiveUrl : Maybe String
    , bytes : Maybe Int
    }


type alias DownloadCatalog =
    { version : Maybe String
    , unsigned : Maybe Bool
    , lanes : List CatalogLane
    , unavailable : List String
    }


type Availability
    = DlLoading
    | DlAvailable
    | DlUnavailable
    | DlUnknown


type CatalogState
    = CatalogLoading
    | CatalogReady
    | CatalogErrored


{-| Decode the staged `catalog.json` body, fail-closed per entry: lanes
that are not objects (or lack a string `lane`) and `unavailable`
entries without a string `lane` are dropped, never guessed.
-}
decodeCatalog : String -> Maybe DownloadCatalog
decodeCatalog body =
    Decode.decodeString catalogDecoder body
        |> Result.toMaybe


catalogDecoder : Decoder DownloadCatalog
catalogDecoder =
    -- Gate on a JSON object first (mirroring the oracle's invalid-shape
    -- throw: arrays and scalars never read as an empty catalog).
    Decode.keyValuePairs Decode.value
        |> Decode.andThen
            (\_ ->
                Decode.map4 DownloadCatalog
                    (Decode.maybe (Decode.field "version" Decode.string))
                    (Decode.maybe (Decode.field "unsigned" Decode.bool))
                    (Decode.oneOf
                        [ Decode.field "lanes" (Decode.list laneDecoder)
                            |> Decode.map (List.filterMap identity)
                        , Decode.succeed []
                        ]
                    )
                    (Decode.oneOf
                        [ Decode.field "unavailable" (Decode.list unavailableLaneDecoder)
                            |> Decode.map (List.filterMap identity)
                        , Decode.succeed []
                        ]
                    )
            )


laneDecoder : Decoder (Maybe CatalogLane)
laneDecoder =
    Decode.oneOf
        [ Decode.map5 (\lane present sha256 archiveUrl bytes -> Just { lane = lane, present = present, sha256 = sha256, archiveUrl = archiveUrl, bytes = bytes })
            (Decode.field "lane" Decode.string)
            (Decode.maybe (Decode.field "present" Decode.bool))
            (Decode.maybe (Decode.field "sha256" Decode.string))
            (Decode.maybe (Decode.field "archiveUrl" Decode.string))
            (Decode.maybe (Decode.field "bytes" Decode.int))
        , Decode.succeed Nothing
        ]


unavailableLaneDecoder : Decoder (Maybe String)
unavailableLaneDecoder =
    Decode.oneOf
        [ Decode.map Just (Decode.field "lane" Decode.string)
        , Decode.succeed Nothing
        ]


{-| Resolve the public availability of one lane without guessing from
static filenames. Only an explicit catalog `present` bit (or an
`unavailable` entry) can establish availability; a missing/failed
catalog remains unknown.
-}
downloadAvailability : Maybe DownloadCatalog -> CatalogState -> String -> Availability
downloadAvailability catalog state lane =
    case state of
        CatalogLoading ->
            DlLoading

        CatalogErrored ->
            DlUnknown

        CatalogReady ->
            case catalog of
                Nothing ->
                    DlUnknown

                Just cat ->
                    if not (isActiveLane lane) then
                        DlUnavailable

                    else
                        case List.filter (\e -> e.lane == lane) cat.lanes |> List.head of
                            Just entry ->
                                case entry.present of
                                    Just True ->
                                        DlAvailable

                                    Just False ->
                                        DlUnavailable

                                    Nothing ->
                                        if List.member lane cat.unavailable then
                                            DlUnavailable

                                        else
                                            DlUnknown

                            Nothing ->
                                if List.member lane cat.unavailable then
                                    DlUnavailable

                                else
                                    DlUnknown


{-| Checksum from the catalog for a lane: only when the lane is marked
present and the hash is a valid 64-hex string (lowercased).
-}
checksumFromCatalog : Maybe DownloadCatalog -> String -> Maybe String
checksumFromCatalog catalog lane =
    if not (isActiveLane lane) then
        Nothing

    else
        case catalog of
            Nothing ->
                Nothing

            Just cat ->
                case List.filter (\e -> e.lane == lane) cat.lanes |> List.head of
                    Just entry ->
                        case entry.present of
                            Just True ->
                                case entry.sha256 of
                                    Just hash ->
                                        if isHex64 hash then
                                            Just (String.toLower hash)

                                        else
                                            Nothing

                                    Nothing ->
                                        Nothing

                            _ ->
                                Nothing

                    Nothing ->
                        Nothing


archiveButtonLabel : String -> String
archiveButtonLabel ext =
    if ext == "zip" then
        "Download zip"

    else
        "Download tar.gz"


signingLabel : String -> String
signingLabel ext =
    if ext == "zip" then
        "none — unsigned zip"

    else
        "none — unsigned tarball"


availabilityLabel : Availability -> String
availabilityLabel a =
    case a of
        DlLoading ->
            "Checking availability"

        DlAvailable ->
            "Available"

        DlUnavailable ->
            "Unavailable"

        DlUnknown ->
            "Availability unknown"


catalogReceipt : CatalogState -> String
catalogReceipt state =
    case state of
        CatalogReady ->
            "Catalog read. Each lane still has to report a published artifact before controls appear."

        CatalogErrored ->
            "Catalog unavailable. Archive, notice, and checksum controls are withheld."

        CatalogLoading ->
            "Checking the staged catalog. Download controls remain withheld."


{-| Fetch key for one lane's `.sha256` sidecar over the `httpFetch` bridge.
-}
checksumKeyForLane : ActiveLane -> String
checksumKeyForLane lane =
    "download-sha256-" ++ activeLaneId lane


{-| The "Verify a download" `<pre>` block with the product version pinned.
-}
verifyPreBlock : String
verifyPreBlock =
    "# after download (example: FreeBSD)\nsha256 -c onyx-"
        ++ productVersion
        ++ "-freebsd-x86_64-ReleaseFast-unsigned.sha256\n# Linux: sha256sum -c …\n# Windows (PowerShell): Get-FileHash .\\\\onyx-…-unsigned.zip -Algorithm SHA256\n# macOS native packages: not published yet — no .sha256 sidecar to check"
