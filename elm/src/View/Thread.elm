module View.Thread exposing (thread)

{-| Message thread: welcome / empty / live states for the active
channel, newest last.
-}

import App exposing (Model, Msg(..))
import Dict
import Html exposing (Html, a, audio, button, div, h2, img, li, section, small, span, strong, text, time, ul, video)
import Html.Attributes exposing (attribute, class, classList, controls, datetime, href, preload, rel, src, tabindex, target, type_)
import Html.Events exposing (on, onClick)
import Json.Decode as Decode
import Set
import Prefs
import Upload


thread : Model -> Html Msg
thread model =
    section [ class "onyx-thread-pane" ]
        [ case model.activeChannel of
            Nothing ->
                div [ class "onyx-empty" ]
                    [ h2 [] [ text "Welcome to Onyx" ]
                    , text "Join a channel from the rail to start reading."
                    ]

            Just name ->
                case Dict.get (String.toLower name) model.channels of
                    Nothing ->
                        div [ class "onyx-empty" ] [ text "Select a channel." ]

                    Just channel ->
                        if List.isEmpty channel.messages then
                            div [ class "onyx-empty" ]
                                [ h2 [] [ text channel.name ]
                                , text "No messages yet. Say hello."
                                ]

                        else
                            let
                                win =
                                    App.threadWindowFor model channel

                                chronological =
                                    App.topicVisibleRows model channel.name (List.reverse channel.messages)

                                rows =
                                    chronological
                                        |> List.drop win.start
                                        |> List.take win.rendered

                                dividerId =
                                    Dict.get (String.toLower channel.name) model.viewUnreadDividerId
                            in
                            div []
                                [ if win.hiddenBefore > 0 then
                                    div [ class "onyx-earlier" ]
                                        [ button
                                            [ class "onyx-earlier-button"
                                            , onClick App.ThreadShowEarlier
                                            , attribute "aria-label" ("Show earlier messages (" ++ String.fromInt win.hiddenBefore ++ " not shown)")
                                            ]
                                            [ text "Show earlier messages "
                                            , span [ class "onyx-earlier-count" ] [ text (String.fromInt win.hiddenBefore) ]
                                            ]
                                        ]

                                  else if App.isHistoryExhausted model channel.name then
                                    div [ class "onyx-intro", attribute "data-testid" "channel-intro" ]
                                        [ span [ class "onyx-intro-glyph", attribute "aria-hidden" "true" ]
                                            [ text (String.left 1 channel.name) ]
                                        , h2 [ class "onyx-intro-title" ] [ text channel.name ]
                                        , text "This is the very beginning of the conversation."
                                        ]

                                  else
                                    text ""
                                , ul [ class "onyx-thread" ]
                                    (List.concatMap
                                        (\m -> [ dividerAbove dividerId m, messageRow model channel.name m ])
                                        rows
                                    )
                                , case App.typingLine model channel.name of
                                    Nothing ->
                                        text ""

                                    Just line ->
                                        div [ class "onyx-typing", attribute "aria-live" "polite" ] [ text line ]
                                , if win.hiddenAfter > 0 then
                                    div [ class "onyx-latest" ]
                                        [ button
                                            [ class "onyx-latest-button"
                                            , onClick App.ThreadShowLatest
                                            , attribute "aria-label" "Back to latest messages"
                                            ]
                                            [ text "Back to latest" ]
                                        ]

                                  else
                                    text ""
                                ]
        , mediaLightboxDialog model
        ]


dividerAbove : Maybe Int -> App.ChatMessage -> Html Msg
dividerAbove dividerId m =
    case dividerId of
        Just boundary ->
            if m.id == boundary then
                div
                    [ class "onyx-unread-divider"
                    , attribute "role" "separator"
                    , attribute "aria-label" "New messages"
                    , attribute "tabindex" "-1"
                    ]
                    [ span [ class "onyx-unread-divider-label" ] [ text "New messages" ] ]

            else
                text ""

        Nothing ->
            text ""


messageRow : Model -> String -> App.ChatMessage -> Html Msg
messageRow model target m =
    let
        uncertainDelivery =
            case m.outboxId of
                Just oid ->
                    List.member oid model.outboxUncertain

                Nothing ->
                    False

        withdrawn =
            m.deleted || m.redacted
    in
    li
        [ classList
            [ ( "onyx-message", True )
            , ( "onyx-whisper", m.whisper )
            , ( "onyx-locked", App.messageLocked m )
            , ( "onyx-pending", m.outboxId /= Nothing || m.pending )
            , ( "onyx-uncertain", uncertainDelivery )
            , ( "onyx-message-search-current", App.searchActiveId model == Just m.id )
            , ( "onyx-mention", m.highlight && not withdrawn )
            , ( "onyx-withdrawn", withdrawn )
            ]
        , attribute "role" "article"
        , attribute "aria-label" (App.messageAccessibleLabel m)
        ]
        [ strong [ class "onyx-sender" ] [ text m.from ]
        , case m.audience of
            Nothing ->
                text ""

            Just _ ->
                span
                    [ class "onyx-audience"
                    , attribute "title" (App.audienceTitle m.audience)
                    ]
                    [ text (App.audienceLabel m.audience) ]
        , if m.at <= 0 then
            text ""

          else
            time [ class "onyx-ts", datetime (App.millisToIso (toFloat m.at)), attribute "aria-hidden" "true" ]
                [ text (App.formatClockUtc m.at) ]
        , span [ class "onyx-body" ] (messageBody model m)
        , if m.outboxId == Nothing && not m.pending then
            text ""

          else if uncertainDelivery then
            span [ class "onyx-pending-note" ] [ text " · delivery uncertain" ]

          else
            span [ class "onyx-pending-note" ] [ text " · queued" ]
        , if m.edited && not withdrawn then
            span [ class "onyx-edited", attribute "title" (editTitle model m) ] [ text " · edited" ]

          else
            text ""
        , boostBar model target m
        ]


editTitle : Model -> App.ChatMessage -> String
editTitle model m =
    case m.msgid of
        Nothing ->
            "Edited"

        Just msgid ->
            case App.revisionsFor model.editHistory msgid of
                [] ->
                    "Edited"

                revs ->
                    "Edited (" ++ String.fromInt (List.length revs) ++ " revisions)"


boostBar : Model -> String -> App.ChatMessage -> Html Msg
boostBar model target m =
    let
        groups =
            App.aggregateBoostGroups m.reactions model.ourNick

        summary =
            App.summarizeBoosts groups model.prefs.reactionDensity
    in
    if summary.hidden || (List.isEmpty summary.chips && summary.overflow <= 0) then
        text ""

    else
        div [ class "boost-bar", attribute "aria-label" "Boosts" ]
            (List.map (boostChip model target m groups) summary.chips
                ++ (if summary.overflow > 0 then
                        [ span [ class "boost-pill boost-pill--more", attribute "aria-label" (String.fromInt summary.overflow ++ " more reaction types") ]
                            [ text ("+" ++ String.fromInt summary.overflow) ]
                        ]

                    else
                        []
                   )
            )


boostChip : Model -> String -> App.ChatMessage -> List App.BoostGroup -> { emoji : String, count : Int, mine : Bool, label : String } -> Html Msg
boostChip model target m groups chip =
    let
        group =
            List.filter (\g -> g.emoji == chip.emoji) groups |> List.head

        title =
            Maybe.withDefault chip.label (Maybe.map App.boostTitle group)

        kids =
            [ span [ class "boost-emoji", attribute "aria-hidden" "true" ] [ text chip.emoji ]
            , span [ class "boost-count" ] [ text (String.fromInt chip.count) ]
            ]
    in
    case ( model.prefs.reactionDensity, m.msgid, group ) of
        ( Prefs.ReactionCountsOnly, _, _ ) ->
            span [ class "boost-pill boost-pill--summary", attribute "aria-label" (String.fromInt chip.count ++ " total boosts") ] kids

        ( _, Just msgid, Just _ ) ->
            button
                [ class "boost-pill"
                , classList [ ( "you", chip.mine ) ]
                , attribute "aria-pressed" (if chip.mine then "true" else "false")
                , attribute "aria-label" ((if chip.mine then "Remove " else "Add ") ++ chip.emoji ++ " boost, " ++ String.fromInt chip.count ++ " total")
                , attribute "title" title
                , onClick (App.ReactionSend target msgid chip.emoji)
                ]
                kids

        _ ->
            span [ class "boost-pill", attribute "title" title ] kids


{-| Row body: the caption as text plus one block per `[file]`
receipt (attached images/videos unfurl inline when the sink gate
passes, everything else renders a `FileChip` link with
`target=_blank`, so no `javascript:` href can reach the DOM),
plus one inline-media unfurl per direct image/video/audio URL,
plus the first-link OG preview card when fetched. -}
messageBody : Model -> App.ChatMessage -> List (Html Msg)
messageBody model m =
    let
        presented =
            Upload.extractAttachmentPresentation (App.displayBody m)
    in
    [ text presented.caption ]
        ++ List.map (attachmentCard model) presented.attachments
        ++ mediaUnfurls model presented
        ++ [ previewCard model (App.displayBody m) ]


{-| Inline-media unfurl (mirrors `MediaUnfurl`): every direct
image/video/audio URL in the body renders an inline player gated by
the same sink policy as OG cards — auto-load for same-origin or
`previewableHosts` URLs, one explicit consent click otherwise, and a
link fallback once the element reports an error. Kind detection
reuses `classifyAttachmentKind` (extension allowlist); `KindFile`
stays fail-closed with no unfurl. -}
mediaUnfurls : Model -> Upload.AttachmentPresentation -> List (Html Msg)
mediaUnfurls model presented =
    let
        privacy =
            App.liveUnfurlPrivacy model

        attached =
            Set.fromList (List.map .url presented.attachments)
    in
    if not privacy.linkPreviews then
        []

    else
        List.filterMap (mediaUnfurl model privacy attached) (Upload.extractHttpUrls presented.caption)


mediaUnfurl : Model -> Upload.UnfurlPrefs -> Set.Set String -> String -> Maybe (Html Msg)
mediaUnfurl model privacy attached href =
    if Set.member href attached then
        Nothing

    else
        case Upload.classifyAttachmentKind href Nothing of
            Upload.KindFile ->
                Nothing

            kind ->
                if Upload.isSameOriginHttpUrl model.origin href || Upload.isPreviewableUrl href privacy then
                    Just (mediaElement model kind href)

                else
                    Nothing


{-| Shared `MediaUnfurl` element (mirrors the oracle `MediaUnfurl`:
credential-free same-origin or public http(s) hosts may load;
cross-origin stays behind consent; errors swap to the fallback
link; images open the lightbox dialog). Narrowing: no focus trap
or return-focus on the dialog (Escape and backdrop close it). -}
mediaElement : Model -> Upload.AttachmentKind -> String -> Html Msg
mediaElement model kind href =
    div [ class "shell-msg-media" ]
        [ if Set.member href model.previewMediaFailed then
            mediaFallback kind href

          else if Upload.isSameOriginHttpUrl model.origin href || Set.member href model.previewImagesAllowed then
            mediaPlayer kind href

          else
            mediaConsent kind href
        ]


mediaKindWord : Upload.AttachmentKind -> String
mediaKindWord kind =
    case kind of
        Upload.KindImage ->
            "image"

        Upload.KindVideo ->
            "video"

        Upload.KindAudio ->
            "audio"

        Upload.KindFile ->
            "file"


mediaPlayer : Upload.AttachmentKind -> String -> Html Msg
mediaPlayer kind href =
    let
        failed =
            Decode.succeed (App.PreviewMediaFailed href)
    in
    case kind of
        Upload.KindImage ->
            button
                [ type_ "button"
                , class "shell-msg-media-open"
                , attribute "aria-label" "Open image"
                , onClick (App.MediaLightboxOpen href)
                ]
                [ img
                    [ src href
                    , attribute "alt" ""
                    , attribute "loading" "lazy"
                    , attribute "decoding" "async"
                    , attribute "referrerpolicy" "no-referrer"
                    , class "shell-msg-media-img"
                    , on "error" failed
                    ]
                    []
                ]

        Upload.KindVideo ->
            video
                [ src href
                , controls True
                , preload "none"
                , class "shell-msg-media-video"
                , attribute "aria-label" "Attached video"
                , attribute "loading" "lazy"
                , on "error" failed
                ]
                []

        Upload.KindAudio ->
            audio
                [ src href
                , controls True
                , preload "none"
                , class "shell-msg-media-audio"
                , attribute "aria-label" "Attached audio"
                , attribute "loading" "lazy"
                , on "error" failed
                ]
                []

        Upload.KindFile ->
            text ""


mediaConsent : Upload.AttachmentKind -> String -> Html Msg
mediaConsent kind href =
    let
        word =
            mediaKindWord kind

        host =
            Upload.parseAbsoluteUrl href
                |> Maybe.map .host
                |> Maybe.withDefault href
    in
    button
        [ type_ "button"
        , class "shell-msg-media-consent"
        , onClick (App.PreviewImageAllow href)
        , attribute "aria-label" ("Load external " ++ word ++ " from " ++ host)
        ]
        [ span [] [ text ("Load external " ++ word) ]
        , small [] [ text host ]
        ]


mediaFallback : Upload.AttachmentKind -> String -> Html Msg
mediaFallback kind url =
    let
        word =
            case kind of
                Upload.KindImage ->
                    "Image"

                Upload.KindVideo ->
                    "Video"

                Upload.KindAudio ->
                    "Audio"

                Upload.KindFile ->
                    "File"
    in
    a
        [ href url
        , target "_blank"
        , rel "noopener noreferrer"
        , class "shell-msg-link shell-msg-media-fallback"
        ]
        [ text (word ++ " preview unavailable — open attachment") ]


{-| Image lightbox dialog (mirrors `MessageImageLightbox`: modal
dialog with backdrop-click and Save/Close actions; Escape closes it
via the top-level subscription). Narrowing: no focus trap or
return-focus. -}
mediaLightboxDialog : Model -> Html Msg
mediaLightboxDialog model =
    case model.mediaLightbox of
        Nothing ->
            text ""

        Just url ->
            div [ class "shell-msg-lightbox", attribute "role" "presentation" ]
                [ div
                    [ class "shell-msg-lightbox-backdrop"
                    , attribute "aria-hidden" "true"
                    , onClick App.MediaLightboxClose
                    ]
                    []
                , div
                    [ class "shell-msg-lightbox-dialog"
                    , attribute "role" "dialog"
                    , attribute "aria-modal" "true"
                    , attribute "aria-label" "Image"
                    , tabindex -1
                    ]
                    [ img
                        [ src url
                        , attribute "alt" ""
                        , class "shell-msg-lightbox-img"
                        , attribute "referrerpolicy" "no-referrer"
                        ]
                        []
                    , div [ class "shell-msg-lightbox-actions" ]
                        [ button
                            [ type_ "button"
                            , class "shell-msg-lightbox-save"
                            , onClick (App.MediaSave url)
                            ]
                            [ text "Save" ]
                        , button
                            [ type_ "button"
                            , class "shell-msg-lightbox-close"
                            , attribute "aria-label" "Close"
                            , onClick App.MediaLightboxClose
                            ]
                            [ text "×" ]
                        ]
                    ]
                ]


{-| First-link OG card (mirrors `LinkPreviewCard`: preference-gated,
canonical URL re-validated at the sink, cross-origin thumbnails
behind an explicit consent click; same-origin thumbnails load
directly). -}
previewCard : Model -> String -> Html Msg
previewCard model body =
    let
        privacy =
            App.liveUnfurlPrivacy model
    in
    if not privacy.linkPreviews then
        text ""

    else
        case previewUrlFor privacy body of
            Nothing ->
                text ""

            Just url ->
                case Dict.get url model.linkPreviews of
                    Just (Just card) ->
                        if previewSafe model card then
                            linkPreviewCard model card

                        else
                            text ""

                    _ ->
                        text ""


{-| First plain web link, media-kind hrefs left for media unfurls
(mirrors the oracle `previewUrl` memo). -}
previewUrlFor : Upload.UnfurlPrefs -> String -> Maybe String
previewUrlFor privacy body =
    Upload.pickPreviewUrl
        (List.filter
            (\href -> Upload.classifyAttachmentKind href Nothing == Upload.KindFile)
            (Upload.extractHttpUrls body)
        )
        privacy


{-| Sink gate (mirrors `isAutoLoadableHttpUrl`): the endpoint-derived
canonical URL must be credential-free same-origin or public http(s). -}
previewSafe : Model -> Upload.LinkPreview -> Bool
previewSafe model card =
    Upload.isSameOriginHttpUrl model.origin card.url
        || Upload.isPreviewableUrl card.url (App.liveUnfurlPrivacy model)


linkPreviewCard : Model -> Upload.LinkPreview -> Html Msg
linkPreviewCard model card =
    let
        thumbnail =
            if String.isEmpty card.image then
                Nothing

            else if
                Upload.isSameOriginHttpUrl model.origin card.image
                    || Set.member card.image model.previewImagesAllowed
            then
                if Upload.isSameOriginHttpUrl model.origin card.image || Upload.isPreviewableUrl card.image Upload.previewSsrfOnly then
                    Just card.image

                else
                    Nothing

            else
                Nothing

        consentNeeded =
            not (String.isEmpty card.image) && thumbnail == Nothing
    in
    span [ class "shell-msg-preview" ]
        [ a
            [ href card.url
            , class "shell-msg-preview-link"
            , target "_blank"
            , rel "noopener noreferrer"
            , attribute "aria-label" ("Link preview: " ++ (if String.isEmpty card.title then card.url else card.title))
            ]
            [ span [ class "shell-msg-preview-body" ]
                ([ if String.isEmpty card.site then
                    text ""

                   else
                    span [ class "shell-msg-preview-site" ] [ text card.site ]
                 , if String.isEmpty card.title then
                    text ""

                   else
                    span [ class "shell-msg-preview-title" ] [ text card.title ]
                 , if String.isEmpty card.description then
                    text ""

                   else
                    span [ class "shell-msg-preview-desc" ] [ text card.description ]
                 ]
                )
            ]
        , case thumbnail of
            Just image ->
                img
                    [ src image
                    , class "shell-msg-preview-thumb"
                    , attribute "alt" ""
                    , attribute "width" "72"
                    , attribute "height" "72"
                    , attribute "loading" "lazy"
                    , attribute "decoding" "async"
                    , attribute "referrerpolicy" "no-referrer"
                    ]
                    []

            Nothing ->
                if consentNeeded then
                    button
                        [ attribute "type" "button"
                        , class "shell-msg-preview-consent"
                        , attribute "aria-label" ("Load external preview image from " ++ previewHost card.image)
                        , onClick (PreviewImageAllow card.image)
                        ]
                        [ text "Load image" ]

                else
                    text ""
        ]


previewHost : String -> String
previewHost url =
    case Upload.parseAbsoluteUrl url of
        Just parsed ->
            parsed.host

        Nothing ->
            "external host"


{-| Attached `[file]` receipt block (mirrors `AttachmentBlock`):
attached images/videos unfurl through the shared media element when
the sink gate passes — first-party uploads are chat media, and
cross-origin ones additionally honor the link-preview preference
(whose consent click lives in the unfurl itself). Everything else
renders a `FileChip` link. -}
attachmentCard : Model -> Upload.ParsedAttachment -> Html Msg
attachmentCard model attachment =
    let
        mediaKind =
            case attachment.kind of
                Upload.KindImage ->
                    Just Upload.KindImage

                Upload.KindVideo ->
                    Just Upload.KindVideo

                _ ->
                    Nothing
    in
    case mediaKind of
        Just kind ->
            if attachmentCanUnfurl model attachment.url then
                mediaElement model kind attachment.url

            else
                fileChip attachment

        Nothing ->
            fileChip attachment


attachmentCanUnfurl : Model -> String -> Bool
attachmentCanUnfurl model url =
    let
        privacy =
            App.liveUnfurlPrivacy model
    in
    (Upload.isSameOriginHttpUrl model.origin url || Upload.isPreviewableUrl url privacy)
        && (Upload.isSameOriginHttpUrl model.origin url || privacy.linkPreviews)


{-| Download chip (mirrors `FileChip`): name plus an optional size,
linked with `target=_blank`. -}
fileChip : Upload.ParsedAttachment -> Html Msg
fileChip attachment =
    a
        [ href attachment.url
        , target "_blank"
        , rel "noopener noreferrer"
        , class "shell-msg-file"
        ]
        [ span [ class "shell-msg-file-name" ]
            [ text (Maybe.withDefault "File" attachment.name) ]
        , case attachment.sizeLabel of
            Just size ->
                span [ class "shell-msg-file-size" ] [ text size ]

            Nothing ->
                text ""
        ]
