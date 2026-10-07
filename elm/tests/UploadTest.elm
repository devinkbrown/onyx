module UploadTest exposing (suite)

{-| Vectors mirroring `src/lib/upload/upload.test.ts`,
`attachmentMessage.test.ts`, `attachmentCaps.test.ts`,
`src/lib/preview/linkPreview.test.ts`, and
`unfurlPrivacy.test.ts` pure suites.
-}

import Expect
import Test exposing (Test, describe, test)
import Upload exposing (..)


suite : Test
suite =
    describe "Upload"
        [ describe "endpoint"
            [ test "defaults to same-origin /upload" <|
                \_ ->
                    Expect.equal (Ok "/upload") (buildUploadEndpoint Nothing)
            , test "builds the endpoint from the media URL" <|
                \_ ->
                    Expect.all
                        [ \_ -> Expect.equal (Ok "https://media.example.test/upload") (buildUploadEndpoint (Just "https://media.example.test"))
                        , \_ -> Expect.equal (Ok "https://media.example.test/upload") (buildUploadEndpoint (Just "https://media.example.test/"))
                        , \_ -> Expect.equal (Ok "https://media.example.test/upload") (buildUploadEndpoint (Just "https://media.example.test/upload"))
                        , \_ -> Expect.equal (Ok "https://media.example.test/api/upload") (buildUploadEndpoint (Just "  https://media.example.test/api///  "))
                        ]
                        ()
            , test "rejects blank and unsafe media URLs" <|
                \_ ->
                    Expect.all
                        [ \_ -> Expect.equal (Err "Media upload URL is not configured.") (buildUploadEndpoint (Just "   "))
                        , \_ -> Expect.equal (Err "Media upload URL must use HTTP(S).") (buildUploadEndpoint (Just "javascript:alert(1)"))
                        , \_ -> Expect.equal (Err "Media upload URL must use HTTP(S) or a root-relative path.") (buildUploadEndpoint (Just "//evil.example/upload"))
                        , \_ -> Expect.equal (Err "Media upload URL must be absolute or root-relative.") (buildUploadEndpoint (Just "media.example/upload"))
                        ]
                        ()
            ]
        , describe "resolve"
            [ test "resolves served paths against the media origin" <|
                \_ ->
                    Expect.all
                        [ \_ -> Expect.equal (Ok "https://media.example.test/uploads/a.png") (resolveUploadUrl "https://media.example.test/api" "/uploads/a.png")
                        , \_ -> Expect.equal (Ok "https://media.example.test/uploads/a.png") (resolveUploadUrl "https://media.example.test" "uploads/a.png")
                        , \_ -> Expect.equal (Ok "https://media.example.test/uploads/a.png") (resolveUploadUrl "https://media.example.test" "a.png")
                        ]
                        ()
            , test "leaves absolute URLs untouched" <|
                \_ ->
                    Expect.equal (Ok "https://cdn.example.test/a.png") (resolveUploadUrl "https://media.example.test" "https://cdn.example.test/a.png")
            , test "rejects unsafe or oversized response URLs" <|
                \_ ->
                    Expect.all
                        [ \_ -> Expect.equal (Err "Upload response returned an unsafe file URL.") (resolveUploadUrl "/upload" "javascript:alert(1)")
                        , \_ -> Expect.equal (Err "Upload response returned an unsafe file URL.") (resolveUploadUrl "/upload" "data:text/html,hello")
                        , \_ -> Expect.equal (Err "Upload response returned an unsafe file URL.") (resolveUploadUrl "/upload" "//evil.example/file")
                        , \_ -> Expect.equal (Err "Upload response file URL is too long.") (resolveUploadUrl "/upload" ("/" ++ String.repeat 2048 "x"))
                        ]
                        ()
            , test "roots relative paths for the default endpoint" <|
                \_ ->
                    Expect.all
                        [ \_ -> Expect.equal (Ok "/uploads/a.png") (resolveUploadUrl "/upload" "a.png")
                        , \_ -> Expect.equal (Ok "/uploads/a.png") (resolveUploadUrl "/upload" "uploads/a.png")
                        ]
                        ()
            ]
        , describe "response"
            [ test "parses JSON with relative paths" <|
                \_ ->
                    Expect.equal
                        (Ok "https://media.example.test/uploads/file.jpg")
                        (parseUploadResponse "https://media.example.test" "{\"path\":\"/uploads/file.jpg\"}" "application/json")
            , test "parses nested file paths after ignoring unusable candidates" <|
                \_ ->
                    Expect.equal
                        (Ok "https://media.example.test/uploads/nested.jpg")
                        (parseUploadResponse "https://media.example.test" "{\"url\":\" \",\"href\":404,\"file\":{\"path\":\"nested.jpg\"},\"filename\":\"fallback.jpg\"}" "Application/JSON; charset=utf-8")
            , test "parses plain-text responses" <|
                \_ ->
                    Expect.equal
                        (Ok "https://media.example.test/uploads/plain.txt")
                        (parseUploadResponse "https://media.example.test" "  /uploads/plain.txt  " "text/plain")
            , test "rejects invalid or empty responses" <|
                \_ ->
                    Expect.all
                        [ \_ -> Expect.equal (Err "Upload service returned invalid JSON.") (parseUploadResponse "https://media.example.test" "{" "application/json")
                        , \_ -> Expect.equal (Err "Upload response did not include a file URL.") (parseUploadResponse "https://media.example.test" "   " "text/plain")
                        , \_ -> Expect.equal (Err "Upload response did not include a file URL.") (parseUploadResponse "https://media.example.test" "{}" "application/json")
                        ]
                        ()
            ]
        , describe "caps"
            [ test "accepts files inside the caps" <|
                \_ ->
                    Expect.equal
                        { acceptIndexes = [ 0, 1 ], error = Nothing }
                        (planAttachmentAccept [ { name = "a.png", size = 10 }, { name = "b.png", size = 20 } ] 0)
            , test "skips oversize files with the size copy" <|
                \_ ->
                    Expect.equal
                        { acceptIndexes = [ 1 ], error = Just "big.bin is larger than 25 MB." }
                        (planAttachmentAccept [ { name = "big.bin", size = 30000000 }, { name = "ok.png", size = 10 } ] 0)
            , test "refuses when the five-file room is full" <|
                \_ ->
                    Expect.equal
                        { acceptIndexes = [], error = Just "You can attach up to 5 files." }
                        (planAttachmentAccept [ { name = "a.png", size = 10 } ] 5)
            , test "formats byte labels" <|
                \_ ->
                    Expect.all
                        [ \_ -> Expect.equal "0 B" (formatAttachmentBytes -1)
                        , \_ -> Expect.equal "512 B" (formatAttachmentBytes 512)
                        , \_ -> Expect.equal "2.0 KB" (formatAttachmentBytes 2048)
                        , \_ -> Expect.equal "25.0 MB" (formatAttachmentBytes 26214400)
                        ]
                        ()
            ]
        , describe "attachment message"
            [ test "builds caption plus receipt lines" <|
                \_ ->
                    Expect.equal
                        (Just "hi\n[file: a.png] 2.0 KB https://cdn.example.test/a.png")
                        (buildAttachmentMessage
                            { url = "https://cdn.example.test/a.png"
                            , name = Just "a.png"
                            , mime = Nothing
                            , sizeBytes = Just 2048
                            , caption = Just "hi"
                            }
                        )
            , test "refuses unsafe urls" <|
                \_ ->
                    Expect.equal Nothing
                        (buildAttachmentMessage
                            { url = "javascript:alert(1)"
                            , name = Nothing
                            , mime = Nothing
                            , sizeBytes = Nothing
                            , caption = Nothing
                            }
                        )
            , test "parses receipt lines and skips garbage" <|
                \_ ->
                    Expect.all
                        [ \_ ->
                            Expect.equal "image"
                                (case parseAttachmentLine "[file: a.png] 2.0 KB https://cdn.example.test/a.png" of
                                    Just parsed ->
                                        case parsed.kind of
                                            KindImage ->
                                                "image"

                                            _ ->
                                                "other"

                                    Nothing ->
                                        "null"
                                )
                        , \_ -> Expect.equal Nothing (parseAttachmentLine "just chatting")
                        , \_ -> Expect.equal Nothing (parseAttachmentLine "[file]")
                        ]
                        ()
            , test "splits caption from attachments" <|
                \_ ->
                    let
                        presented =
                            extractAttachmentPresentation "hello\n[file] https://cdn.example.test/a.png"
                    in
                    Expect.all
                        [ \_ -> Expect.equal "hello" presented.caption
                        , \_ -> Expect.equal 1 (List.length presented.attachments)
                        ]
                        ()
            , test "sniffs photos by mime or name" <|
                \_ ->
                    Expect.all
                        [ \_ -> Expect.equal True (isPhotoFile { name = "a.bin", mime = "image/png" })
                        , \_ -> Expect.equal True (isPhotoFile { name = "a.webp", mime = "application/octet-stream" })
                        , \_ -> Expect.equal False (isPhotoFile { name = "a.mp4", mime = "video/mp4" })
                        ]
                        ()
            ]
        , describe "preview privacy"
            [ test "picks the first http(s) link" <|
                \_ ->
                    Expect.equal
                        (Just "https://example.test/a")
                        (pickPreviewUrl [ "javascript:alert(1)", "https://example.test/a" ] previewSsrfOnly)
            , test "skips our own uploads" <|
                \_ ->
                    Expect.equal Nothing
                        (pickPreviewUrl [ "https://eshmaki.me/uploads/a.png" ] previewSsrfOnly)
            , test "returns null when privacy disables linkPreviews" <|
                \_ ->
                    Expect.equal Nothing
                        (pickPreviewUrl [ "https://example.test/a" ] { linkPreviews = False, httpsOnly = True, blockedHosts = [] })
            , test "rejects dangerous schemes and credentials" <|
                \_ ->
                    Expect.all
                        [ \_ -> Expect.equal False (isPreviewableUrl "javascript:alert(1)" previewSsrfOnly)
                        , \_ -> Expect.equal False (isPreviewableUrl "https://user:pass@example.test/" previewSsrfOnly)
                        , \_ -> Expect.equal False (isPreviewableUrl "https://localhost/x" previewSsrfOnly)
                        , \_ -> Expect.equal False (isPreviewableUrl "https://wiki.internal./x" { linkPreviews = True, httpsOnly = True, blockedHosts = [] })
                        , \_ -> Expect.equal True (isPreviewableUrl "https://example.test./x" previewSsrfOnly)
                        ]
                        ()
            , test "rejects private IPv4 and IPv6 literals" <|
                \_ ->
                    Expect.all
                        [ \_ -> Expect.equal False (isPreviewableUrl "http://169.254.169.254/" previewSsrfOnly)
                        , \_ -> Expect.equal False (isPreviewableUrl "http://[::1]/" previewSsrfOnly)
                        , \_ -> Expect.equal False (isPreviewableUrl "http://[::ffff:127.0.0.1]/" previewSsrfOnly)
                        , \_ -> Expect.equal True (isPreviewableUrl "https://example.test/a" previewSsrfOnly)
                        ]
                        ()
            , test "honors httpsOnly and blocked hosts" <|
                \_ ->
                    Expect.all
                        [ \_ -> Expect.equal False (isPreviewableUrl "http://example.test/a" defaultUnfurlPrivacy)
                        , \_ -> Expect.equal False (isPreviewableUrl "https://intranet.corp/x" { linkPreviews = True, httpsOnly = True, blockedHosts = [ "intranet.corp" ] })
                        , \_ -> Expect.equal False (isPreviewableUrl "https://sub.intranet.corp/x" { linkPreviews = True, httpsOnly = True, blockedHosts = [ "intranet.corp" ] })
                        ]
                        ()
            ]
        ]
