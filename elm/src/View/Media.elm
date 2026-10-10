module View.Media exposing (mediaPanel)

{-| Conversation media panel, mirroring
`src/shell/RoomMediaIndex.tsx`: Pictures · Files · Links over the
live conversation plus recovered device history, with the
device-scope badge, loading/error/empty states, per-picture consent,
and jump-to-message.

Narrowings: no vault-status copy split beyond recovered-vs-empty
(the bridge reports `ok` vs anything else, so a failed fetch with
recovered rows reads as incomplete); jump closes through the landing
or travel machinery (no scroll coupling); the trigger is a topbar
toggle like pins, not a ribbon-menu item; previewable-but-unfetched
cross-origin pictures gate on a per-href allow, not the row-scoped
signal.
-}

import App exposing (Model, Msg(..))
import Html exposing (Html, a, button, div, img, li, p, span, strong, text, ul)
import Html.Attributes exposing (attribute, class, href, rel, src, target, title, type_)
import Html.Events exposing (on, onClick)
import View.Icon exposing (icon)
import Json.Decode as Decode
import Provenance
import RoomMedia exposing (RoomMediaFilter(..))
import Set
import Upload
import View.Sheet as Sheet


{-| The panel: nothing while closed, otherwise the dialog with
context, filters, status lines, and the three item lists. -}
mediaPanel : Model -> Html Msg
mediaPanel model =
    if not model.mediaIndexOpen then
        text ""

    else
        Sheet.view
            { scope = "media"
            , label = Sheet.Labelled "Pictures, files, and links"
            , onClose = MediaIndexClose
            , placement = Sheet.Side
            , layerClass = ""
            , panelClass = "room-media-index"
            , backdropClass = ""
            , layerAttrs = []
            , modal = True
            , attrs = [ attribute "data-testid" "room-media-index" ]
            }
                [ div [ class "room-media-index-head" ]
                    [ span [ class "room-media-index-title" ] [ text "Pictures, files, and links" ]
                    , button
                        [ attribute "type" "button"
                        , class "room-media-index-close"
                        , attribute "aria-label" "Close pictures, files, and links"
                        , onClick MediaIndexClose
                        ]
                        [ icon "x" ]
                    ]
                , p [ class "room-media-index-desc" ]
                    [ text "From this conversation, indexed on this device. Selecting an item returns you to its message; links open the destination in a new tab." ]
                , div [ class "room-media-index-context", attribute "data-testid" "room-media-index-context" ]
                    [ div [ class "room-media-index-context-copy" ]
                        [ span [ class "room-media-index-context-kicker" ] [ text "Conversation media" ]
                        , text " "
                        , strong [] [ text model.mediaIndexTarget ]
                        ]
                    , provenanceBadge
                    ]
                , filterTabs model
                , statusBlock model
                , filterPanel model Pictures "Pictures"
                , filterPanel model Files "Files"
                , filterPanel model Links "Links"
                ]


{-| Device-scope badge (mirroring `ProvenanceBadge` for the
conversation-media subject). -}
provenanceBadge : Html Msg
provenanceBadge =
    span
        [ class "provenance-badge"
        , attribute "data-scope" (Provenance.scopeToString Provenance.Device)
        , attribute "aria-label" (Provenance.ariaLabel Provenance.Device "Conversation media index")
        , title (Provenance.descriptionFor Provenance.Device)
        ]
        [ text (Provenance.labelFor Provenance.Device) ]


filterTabs : Model -> Html Msg
filterTabs model =
    div [ class "room-media-index-filters", attribute "role" "tablist", attribute "aria-label" "Pictures, files, and links" ]
        (List.map (filterTab model.mediaIndexFilter) [ ( Pictures, "Pictures" ), ( Files, "Files" ), ( Links, "Links" ) ])


filterTab : RoomMediaFilter -> ( RoomMediaFilter, String ) -> Html Msg
filterTab active ( filter, label ) =
    button
        [ type_ "button"
        , class "room-media-index-filter"
        , attribute "role" "tab"
        , attribute "aria-selected"
            (if active == filter then
                "true"

             else
                "false"
            )
        , onClick (MediaIndexFilter { filter = filter })
        ]
        [ text label ]


statusBlock : Model -> Html Msg
statusBlock model =
    case model.mediaIndexVaultState of
        App.MediaVaultLoading ->
            div [ class "room-media-index-status room-media-index-status--loading", attribute "role" "status" ]
                [ span [] [ text "Loading media from this device…" ]
                , span [ class "room-media-index-skeleton", attribute "aria-hidden" "true" ] []
                ]

        App.MediaVaultFailed ->
            div [ class "room-media-index-status room-media-index-status--error", attribute "role" "alert" ]
                [ p []
                    [ text
                        (if List.isEmpty model.mediaIndexVault then
                            "Device history is unavailable. Showing media from the live conversation and any history recovered."

                         else
                            "Device history is incomplete. Showing live media and the history recovered so far; more history may exist."
                        )
                    ]
                , button
                    [ type_ "button"
                    , class "room-media-index-retry"
                    , onClick MediaIndexRetry
                    ]
                    [ text "Retry" ]
                ]

        App.MediaVaultReady ->
            text ""


filterPanel : Model -> RoomMediaFilter -> String -> Html Msg
filterPanel model filter label =
    let
        items =
            RoomMedia.itemsForFilter (App.mediaIndexFor model) filter

        filterId =
            case filter of
                Pictures ->
                    "pictures"

                Files ->
                    "files"

                Links ->
                    "links"
    in
    div
        [ class "room-media-index-panel"
        , attribute "data-media-filter" filterId
        , attribute "role" "tabpanel"
        , attribute "aria-label" label
        , Html.Attributes.hidden (model.mediaIndexFilter /= filter)
        ]
        [ ul [ class "room-media-index-list", attribute "aria-label" (label ++ " in this conversation") ]
            (List.map (mediaItem model) items)
        , if model.mediaIndexVaultState /= App.MediaVaultLoading && List.isEmpty items then
            p [ class "room-media-index-empty" ] [ text (RoomMedia.emptyCopy filter) ]

          else
            text ""
        ]


mediaItem : Model -> RoomMedia.RoomMediaEntry -> Html Msg
mediaItem model entry =
    li [ class "room-media-index-item" ]
        [ case entry.kind of
            Pictures ->
                pictureRow model entry

            Files ->
                fileRow entry

            Links ->
                linkRow entry
        ]


pictureRow : Model -> RoomMedia.RoomMediaEntry -> Html Msg
pictureRow model entry =
    let
        privacy =
            App.liveUnfurlPrivacy model

        label =
            Maybe.withDefault "Picture" entry.name

        sameOrigin =
            Upload.isSameOriginHttpUrl model.origin entry.href

        allowedHref =
            if not privacy.linkPreviews then
                Nothing

            else if sameOrigin then
                Just entry.href

            else if Upload.isPreviewableUrl entry.href privacy && Set.member entry.href model.mediaPictureAllowed then
                Just entry.href

            else
                Nothing

        loadable =
            privacy.linkPreviews && Upload.isPreviewableUrl entry.href privacy && not sameOrigin
    in
    div [ class "room-media-index-row room-media-index-row--picture" ]
        [ span [ class "room-media-index-picture-frame" ]
            [ case allowedHref of
                Just href ->
                    img
                        [ src href
                        , attribute "alt" ""
                        , attribute "loading" "lazy"
                        , attribute "decoding" "async"
                        , attribute "referrerpolicy" "no-referrer"
                        , on "error" (Decode.succeed (PreviewMediaFailed href))
                        ]
                        []

                Nothing ->
                    if loadable then
                        button
                            [ type_ "button"
                            , class "room-media-index-jump room-media-index-picture-load"
                            , attribute "aria-label" ("Load external picture from " ++ RoomMedia.linkDomain entry.href)
                            , onClick (MediaPictureAllow { href = entry.href })
                            ]
                            [ text "Load picture" ]

                    else
                        span [ class "room-media-index-picture-fallback" ] [ text "Preview unavailable" ]
            ]
        , span [ class "room-media-index-copy" ]
            [ span [ class "room-media-index-title", title label ] [ text label ]
            , span [ class "room-media-index-meta" ]
                [ span [] [ text entry.from ]
                , span [ attribute "aria-hidden" "true" ] [ text " · " ]
                , span [] [ text (Maybe.withDefault "Size not recorded" entry.sizeLabel) ]
                ]
            ]
        , button
            [ type_ "button"
            , class "room-media-index-jump"
            , attribute "aria-label" ("Jump to picture " ++ label)
            , onClick (MediaIndexJump { messageId = entry.messageId, at = entry.at })
            ]
            [ text "Jump" ]
        ]


fileRow : RoomMedia.RoomMediaEntry -> Html Msg
fileRow entry =
    let
        label =
            Maybe.withDefault "File" entry.name
    in
    button
        [ type_ "button"
        , class "room-media-index-row room-media-index-row--file"
        , attribute "aria-label" ("Jump to file " ++ label)
        , onClick (MediaIndexJump { messageId = entry.messageId, at = entry.at })
        ]
        [ span [ class "room-media-index-filemark", attribute "aria-hidden" "true" ] [ text "file" ]
        , span [ class "room-media-index-copy" ]
            [ span [ class "room-media-index-title", title label ] [ text label ]
            , span [ class "room-media-index-meta" ]
                [ span [] [ text entry.from ]
                , span [ attribute "aria-hidden" "true" ] [ text " · " ]
                , span [] [ text (Maybe.withDefault "Size not recorded" entry.sizeLabel) ]
                ]
            ]
        ]


linkRow : RoomMedia.RoomMediaEntry -> Html Msg
linkRow entry =
    let
        domain =
            Maybe.withDefault entry.href entry.domain
    in
    div [ class "room-media-index-link" ]
        [ a
            [ class "room-media-index-row room-media-index-row--link"
            , href entry.href
            , attribute "aria-label" ("Open link to " ++ domain)
            , title entry.href
            , target "_blank"
            , rel "noopener noreferrer"
            ]
            [ span [ class "room-media-index-copy" ]
                [ span [ class "room-media-index-title" ] [ text domain ]
                , span [ class "room-media-index-meta", attribute "dir" "auto" ]
                    [ span [] [ text entry.href ]
                    , span [ attribute "aria-hidden" "true" ] [ text " · " ]
                    , span [] [ text entry.from ]
                    ]
                ]
            ]
        , button
            [ type_ "button"
            , class "room-media-index-jump"
            , attribute "aria-label" ("Jump to link " ++ domain)
            , onClick (MediaIndexJump { messageId = entry.messageId, at = entry.at })
            ]
            [ text "Jump" ]
        ]
