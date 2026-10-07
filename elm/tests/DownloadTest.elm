module DownloadTest exposing (suite)

{-| Download surface parity vectors, mirroring the `downloadMeta`
section of `src/routes/Download.test.tsx`: pinned cards, archive URLs,
install steps, sha parsing, catalog checksums/availability, plus the
catalog JSON decoder and macOS coming-soon invariants.
-}

import Download exposing (..)
import Expect
import Test exposing (Test, describe, test)


hash64 : String
hash64 =
    String.repeat 32 "ab"


catalogWith : List CatalogLane -> DownloadCatalog
catalogWith lanes =
    { version = Nothing, unsigned = Nothing, lanes = lanes, unavailable = [] }


laneEntry : String -> Maybe Bool -> Maybe String -> CatalogLane
laneEntry lane present sha256 =
    { lane = lane, present = present, sha256 = sha256, archiveUrl = Nothing, bytes = Nothing }


cardFor : ActiveLane -> Maybe DownloadCard
cardFor lane =
    downloadCards
        |> List.filter (\c -> c.lane == lane)
        |> List.head


suite : Test
suite =
    describe "Download"
        [ test "pins four active site-local packages in order" <|
            \_ ->
                Expect.all
                    [ \_ -> Expect.equal "0.1.3" productVersion
                    , \_ -> Expect.equal 4 (List.length downloadCards)
                    , \_ ->
                        Expect.equal [ "windows", "linux", "freebsd", "openbsd" ]
                            (List.map (\c -> activeLaneId c.lane) downloadCards)
                    ]
                    ()
        , test "archive URLs match the release staging layout" <|
            \_ ->
                Expect.all
                    [ \_ ->
                        Expect.equal (Just "/downloads/v0.1.3/onyx-0.1.3-windows-x86_64-ReleaseFast-unsigned.zip")
                            (Maybe.map .archiveUrl (cardFor Windows))
                    , \_ ->
                        Expect.equal (Just "/downloads/v0.1.3/onyx-0.1.3-linux-x86_64-ReleaseFast-unsigned.tar.gz")
                            (Maybe.map .archiveUrl (cardFor Linux))
                    , \_ ->
                        Expect.equal (Just "/downloads/v0.1.3/onyx-0.1.3-freebsd-x86_64-ReleaseFast-unsigned.tar.gz")
                            (Maybe.map .archiveUrl (cardFor FreeBSD))
                    , \_ ->
                        Expect.equal (Just "/downloads/v0.1.3/onyx-0.1.3-openbsd-x86_64-ReleaseFast-unsigned.tar.gz")
                            (Maybe.map .archiveUrl (cardFor OpenBSD))
                    , \_ -> Expect.equal (Just "zip") (Maybe.map .archiveExt (cardFor Windows))
                    , \_ -> Expect.equal (Just [ "gtk4", "webkit2-gtk_60" ]) (Maybe.map .primaryPackages (cardFor FreeBSD))
                    , \_ -> Expect.equal (Just True) (Maybe.map .runtimeIncluded (cardFor Windows))
                    , \_ -> Expect.equal (Just True) (Maybe.map .hasInstallScript (cardFor Linux))
                    , \_ -> Expect.equal "/downloads/v0.1.3/catalog.json" downloadCatalogUrl
                    ]
                    ()
        , test "install steps name the per-lane entrypoint" <|
            \_ ->
                Expect.all
                    [ \_ -> Expect.equal True (List.any (String.contains "install.sh") (installSteps FreeBSD))
                    , \_ -> Expect.equal True (List.any (String.contains "Install-and-Run-Onyx.cmd") (installSteps Windows))
                    , \_ -> Expect.equal True (List.any (String.contains "install.sh") (installSteps Linux))
                    , \_ -> Expect.equal True (List.any (String.contains "pkg_add") (installSteps OpenBSD))
                    , \_ -> Expect.equal "onyx-0.1.3-windows-ReleaseFast" (packageRootName Windows)
                    , \_ -> Expect.equal "onyx-0.1.3-linux-ReleaseFast" (packageRootName Linux)
                    , \_ -> Expect.equal "onyx-0.1.3-freebsd-x86_64-ReleaseFast" (packageRootName FreeBSD)
                    ]
                    ()
        , test "macOS is coming-soon metadata only, never an active lane" <|
            \_ ->
                Expect.all
                    [ \_ -> Expect.equal "Coming soon" macosCard.statusLabel
                    , \_ -> Expect.equal [ "x86_64", "arm64" ] (List.map .arch macosCard.arches)
                    , \_ -> Expect.equal False (isActiveLane "macos-x86_64")
                    , \_ -> Expect.equal False (isActiveLane "macos-arm64")
                    , \_ -> Expect.equal True (isActiveLane "linux")
                    , \_ -> Expect.equal Nothing (laneFromString "macos-x86_64")
                    , \_ -> Expect.equal (Just Linux) (laneFromString "linux")
                    , \_ -> Expect.equal Nothing (checksumFromCatalog (Just (catalogWith [ laneEntry "macos-x86_64" (Just True) (Just hash64) ])) "macos-x86_64")
                    , \_ -> Expect.equal "Download zip" (archiveButtonLabel "zip")
                    , \_ -> Expect.equal "Download tar.gz" (archiveButtonLabel "tar.gz")
                    , \_ -> Expect.equal "none — unsigned zip" (signingLabel "zip")
                    , \_ -> Expect.equal "none — unsigned tarball" (signingLabel "tar.gz")
                    ]
                    ()
        , test "parses checksums and catalog hashes fail-closed" <|
            \_ ->
                Expect.all
                    [ \_ -> Expect.equal Nothing (parseSha256SumText "not-a-hash")
                    , \_ -> Expect.equal (Just hash64) (Maybe.map .hash (parseSha256SumText (hash64 ++ "  file.tar.gz\n")))
                    , \_ -> Expect.equal (Just "file.tar.gz") (Maybe.map .name (parseSha256SumText (hash64 ++ "  file.tar.gz\n")))
                    , \_ -> Expect.equal Nothing (parseSha256SumText (hash64 ++ " file.tar.gz"))
                    , \_ -> Expect.equal Nothing (parseSha256SumText "")
                    , \_ ->
                        Expect.equal (Just hash64)
                            (checksumFromCatalog (Just (catalogWith [ laneEntry "freebsd" (Just True) (Just hash64) ])) "freebsd")
                    , \_ ->
                        Expect.equal Nothing
                            (checksumFromCatalog (Just (catalogWith [ laneEntry "freebsd" (Just False) (Just hash64) ])) "freebsd")
                    , \_ ->
                        Expect.equal (Just hash64)
                            (checksumFromCatalog (Just (catalogWith [ laneEntry "windows" (Just True) (Just (String.toUpper hash64)) ])) "windows")
                    , \_ ->
                        Expect.equal Nothing
                            (checksumFromCatalog (Just (catalogWith [ laneEntry "freebsd" (Just True) (Just "xyz") ])) "freebsd")
                    , \_ -> Expect.equal Nothing (checksumFromCatalog Nothing "freebsd")
                    ]
                    ()
        , test "availability never guesses from static filenames" <|
            \_ ->
                Expect.all
                    [ \_ -> Expect.equal DlLoading (downloadAvailability Nothing CatalogLoading "freebsd")
                    , \_ -> Expect.equal DlUnknown (downloadAvailability Nothing CatalogErrored "freebsd")
                    , \_ -> Expect.equal DlUnknown (downloadAvailability Nothing CatalogReady "freebsd")
                    , \_ ->
                        Expect.equal DlUnavailable
                            (downloadAvailability (Just (catalogWith [ laneEntry "freebsd" (Just False) Nothing ])) CatalogReady "freebsd")
                    , \_ ->
                        Expect.equal DlAvailable
                            (downloadAvailability (Just (catalogWith [ laneEntry "freebsd" (Just True) Nothing ])) CatalogReady "freebsd")
                    , \_ ->
                        Expect.equal DlUnknown
                            (downloadAvailability (Just (catalogWith [])) CatalogReady "freebsd")
                    , \_ ->
                        Expect.equal DlUnavailable
                            (downloadAvailability (Just { version = Nothing, unsigned = Nothing, lanes = [], unavailable = [ "freebsd" ] }) CatalogReady "freebsd")
                    , \_ ->
                        Expect.equal DlUnavailable
                            (downloadAvailability (Just (catalogWith [ laneEntry "freebsd" (Just True) Nothing ])) CatalogReady "macos-x86_64")
                    , \_ -> Expect.equal "Checking availability" (availabilityLabel DlLoading)
                    , \_ -> Expect.equal "Available" (availabilityLabel DlAvailable)
                    , \_ -> Expect.equal "Unavailable" (availabilityLabel DlUnavailable)
                    , \_ -> Expect.equal "Availability unknown" (availabilityLabel DlUnknown)
                    ]
                    ()
        , test "catalog JSON decodes fail-closed per entry" <|
            \_ ->
                Expect.all
                    [ \_ ->
                        case decodeCatalog ("{\"lanes\":[{\"lane\":\"linux\",\"present\":true,\"sha256\":\"" ++ hash64 ++ "\"}]}") of
                            Just catalog ->
                                Expect.all
                                    [ \_ -> Expect.equal DlAvailable (downloadAvailability (Just catalog) CatalogReady "linux")
                                    , \_ -> Expect.equal (Just hash64) (checksumFromCatalog (Just catalog) "linux")
                                    ]
                                    ()

                            Nothing ->
                                Expect.fail "expected a catalog"
                    , \_ ->
                        case decodeCatalog "{\"lanes\":[42,{\"present\":true},{\"lane\":\"windows\",\"present\":false}],\"unavailable\":[{\"lane\":\"openbsd\"},7]}" of
                            Just catalog ->
                                Expect.all
                                    [ \_ -> Expect.equal DlUnavailable (downloadAvailability (Just catalog) CatalogReady "windows")
                                    , \_ -> Expect.equal DlUnavailable (downloadAvailability (Just catalog) CatalogReady "openbsd")
                                    , \_ -> Expect.equal DlUnknown (downloadAvailability (Just catalog) CatalogReady "linux")
                                    ]
                                    ()

                            Nothing ->
                                Expect.fail "expected a catalog with bad entries dropped"
                    , \_ -> Expect.equal Nothing (decodeCatalog "not json")
                    , \_ -> Expect.equal Nothing (decodeCatalog "[1,2]")
                    , \_ ->
                        Expect.equal "download-sha256-linux" (checksumKeyForLane Linux)
                    , \_ ->
                        Expect.equal True (String.contains "0.1.3" verifyPreBlock)
                    , \_ ->
                        Expect.equal True
                            (String.contains "Catalog read. Each lane still has to report" (catalogReceipt CatalogReady))
                    ]
                    ()
        ]
