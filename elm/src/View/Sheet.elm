module View.Sheet exposing
    ( Config
    , Head
    , Label(..)
    , Placement(..)
    , autofocus
    , closeButton
    , config
    , escapeDecoder
    , head
    , header
    , headerWith
    , swipeDismissDecoder
    , titleId
    , view
    , viewPinned
    )

{-| v3/frame — the ONE sheet/dialog primitive.

Every overlay sheet in the shell renders through `view`, which gives it
the APG dialog contract in one place:

  - a fixed layer with a light-dismiss backdrop (`onyx-sheet-backdrop`);
  - a `role="dialog"` panel with `aria-modal` and either
    `aria-labelledby` (preferred) or an `aria-label`;
  - `data-shortcut-scope` — the marker `ports.js` (`installOverlayFocus`)
    uses to give the topmost sheet initial focus (its
    `data-onyx-autofocus` child, else the panel itself), wrap Tab
    inside it, and return focus to the opener when it unmounts;
  - Escape on the panel closes it and `preventDefault`s, so the global
    `shortcut` port's Escape (`App.escapeMsg`, the ordered overlay
    list) never closes a second overlay for the same key press.

v3/ui-sheets — on phones every light-dismiss sheet is a
true bottom sheet (v3/rx-sheets: under 600px wide; fold-open and
tablets keep centred dialogs and side panels, short landscape windows
get nearly full-height dialogs — see `css/ui-sheets.css`): a grab handle, a sticky head, internal scroll, the
safe-area inset, and swipe-down-to-dismiss. The swipe needs no
JavaScript: the layer is a `column-reverse` scroll container whose
first child is the panel and whose last is a full-height spacer (see
`ui-sheets.css`), snapped open or shut with `scroll-snap`. Dragging the
sheet down scrolls the layer toward the spacer; once it has scrolled
the whole panel out of view the layer's own `scroll` event
(`swipeDismissDecoder`) sends `onClose`. On wider screens the layer
does not scroll and the spacer is hidden, so nothing changes there.
Pinned sheets (`viewPinned`) never swipe away.

Existing sheets keep their own panel class (`panelClass`) so their
copy, test ids and per-sheet styling stay put; the layer, backdrop,
placement, elevation, head and entrance motion come from the shared
`.onyx-sheet*` rules (`app.css`, refined in `css/ui-sheets.css`).

-}

import Html exposing (Html, button, div, h2, p, section, span, text)
import Html.Attributes exposing (attribute, class, id, type_)
import Html.Events exposing (custom, on, onClick)
import Json.Decode as Decode


{-| Where the panel sits. `Center` is the default dialog; `Side` is a
right-hand drawer on desktop; `Popover` drops from the top-right of the
shell (under the global top bar) like a menu panel. All three become
bottom sheets under 600px.
-}
type Placement
    = Center
    | Side
    | Popover


{-| How the dialog is named: `LabelledBy` an element id inside the
panel (the APG default), or a plain `Labelled` string.
-}
type Label
    = LabelledBy String
    | Labelled String


type alias Config msg =
    { scope : String
    , label : Label
    , onClose : msg
    , placement : Placement
    , layerClass : String
    , panelClass : String
    , backdropClass : String
    , layerAttrs : List (Html.Attribute msg)
    , modal : Bool
    , attrs : List (Html.Attribute msg)
    }


{-| Defaults: a centred modal labelled by `titleId scope`. -}
config : { scope : String, onClose : msg } -> Config msg
config args =
    { scope = args.scope
    , label = LabelledBy (titleId args.scope)
    , onClose = args.onClose
    , placement = Center
    , layerClass = ""
    , panelClass = ""
    , backdropClass = ""
    , layerAttrs = []
    , modal = True
    , attrs = []
    }


{-| The conventional title id for a sheet scope. -}
titleId : String -> String
titleId scope =
    "onyx-sheet-" ++ scope ++ "-title"


{-| Mark the element that should take initial focus. -}
autofocus : String -> Html.Attribute msg
autofocus scope =
    attribute "data-onyx-autofocus" scope


view : Config msg -> List (Html msg) -> Html msg
view cfg body =
    render True cfg body


{-| v3/calls-c6 — the same dialog without light dismiss: a backdrop
click does nothing (a DM ring must never be declined by a stray
click, spec §2.9). Escape still sends `onClose`. No grab handle and no
swipe-to-dismiss either.
-}
viewPinned : Config msg -> List (Html msg) -> Html msg
viewPinned cfg body =
    render False cfg body


render : Bool -> Config msg -> List (Html msg) -> Html msg
render lightDismiss cfg body =
    div
        ([ class (join "onyx-sheet-layer" cfg.layerClass)
         , attribute "data-placement" (placementKey cfg.placement)
         , attribute "data-swipe" (boolString lightDismiss)
         ]
            ++ (if lightDismiss then
                    [ on "scroll" (swipeDismissDecoder cfg.onClose) ]

                else
                    []
               )
            ++ cfg.layerAttrs
        )
        ([ div
            ([ class (join "onyx-sheet-backdrop" cfg.backdropClass)
             , attribute "aria-hidden" "true"
             , attribute "data-testid" (cfg.scope ++ "-backdrop")
             ]
                ++ (if lightDismiss then
                        [ onClick cfg.onClose ]

                    else
                        []
                   )
            )
            []
         , section
            ([ class (join "onyx-sheet" cfg.panelClass)
             , attribute "role" "dialog"
             , attribute "aria-modal"
                (if cfg.modal then
                    "true"

                 else
                    "false"
                )
             , labelAttr cfg.label
             , attribute "data-shortcut-scope" cfg.scope
             , attribute "tabindex" "-1"
             , -- v3/rx-sheets: Escape closes THIS sheet only. A sheet nested
               -- in another sheet's DOM (the room desk's member-action
               -- review) would otherwise let the key bubble to its parent
               -- panel and close both; the global shortcut port still sees
               -- `defaultPrevented` and stands aside.
               custom "keydown"
                (Decode.map (\m -> { message = m, stopPropagation = True, preventDefault = True }) (escapeDecoder cfg.onClose))
             ]
                ++ cfg.attrs
            )
            (if lightDismiss then
                div [ class "onyx-sheet-grip", attribute "aria-hidden" "true" ] [] :: body

             else
                body
            )
         ]
            ++ (if lightDismiss then
                    [ div [ class "onyx-sheet-spacer", attribute "aria-hidden" "true" ] [] ]

                else
                    []
               )
        )


{-| Swipe-down-to-dismiss, read from the layer's own `scroll` event.

The phone layer is a `column-reverse` scroller, so its `scrollTop` is
0 with the sheet fully open and goes negative as the sheet is dragged
down; it reaches `-(scrollHeight - clientHeight)` once the panel has
left the viewport. Only that end position closes. The class check keeps
a nested scroller's event (which never bubbles here, but a capturing
host might re-dispatch) from ever closing the sheet, and a positive
`scrollTop` (a normal top-down scroller) never qualifies.
-}
swipeDismissDecoder : msg -> Decode.Decoder msg
swipeDismissDecoder close =
    Decode.map4
        (\cls top height client -> { cls = cls, top = top, height = height, client = client })
        (Decode.oneOf [ Decode.at [ "target", "className" ] Decode.string, Decode.succeed "" ])
        (Decode.at [ "target", "scrollTop" ] Decode.float)
        (Decode.at [ "target", "scrollHeight" ] Decode.float)
        (Decode.at [ "target", "clientHeight" ] Decode.float)
        |> Decode.andThen
            (\s ->
                let
                    travel =
                        s.height - s.client
                in
                if
                    String.contains "onyx-sheet-layer" s.cls
                        && travel > 48
                        && s.top < 0
                        && negate s.top >= travel - 2
                then
                    Decode.succeed close

                else
                    Decode.fail "sheet still open"
            )


{-| The standard head: a titled `h2` (id `titleId scope`) and a close
button. Sheets with bespoke heads keep theirs and use `closeButton`.
-}
header :
    { scope : String, title : String, closeLabel : String, onClose : msg, closeTestId : Maybe String }
    -> Html msg
header h =
    headerWith
        (head
            { scope = h.scope
            , title = h.title
            , closeLabel = h.closeLabel
            , onClose = h.onClose
            }
            |> (\d -> { d | closeTestId = h.closeTestId })
        )


{-| The full head: an optional kicker over the title, an optional
subtitle under it, optional trailing actions, and the close button.
Every field beyond `head`'s four is optional; ids default to
`titleId scope`.
-}
type alias Head msg =
    { scope : String
    , title : String
    , titleId : Maybe String
    , titleClass : String
    , kicker : Maybe String
    , subtitle : Maybe String
    , subtitleId : Maybe String
    , actions : List (Html msg)
    , closeLabel : String
    , onClose : msg
    , closeTestId : Maybe String
    , closeClass : String
    , closeAttrs : List (Html.Attribute msg)
    , headClass : String
    }


head : { scope : String, title : String, closeLabel : String, onClose : msg } -> Head msg
head h =
    { scope = h.scope
    , title = h.title
    , titleId = Nothing
    , titleClass = ""
    , kicker = Nothing
    , subtitle = Nothing
    , subtitleId = Nothing
    , actions = []
    , closeLabel = h.closeLabel
    , onClose = h.onClose
    , closeTestId = Nothing
    , closeClass = ""
    , closeAttrs = []
    , headClass = ""
    }


headerWith : Head msg -> Html msg
headerWith h =
    div [ class (join "onyx-sheet-head" h.headClass) ]
        ([ div [ class "onyx-sheet-heading" ]
            ((case h.kicker of
                Just k ->
                    [ p [ class "onyx-sheet-kicker" ] [ text k ] ]

                Nothing ->
                    []
             )
                ++ [ h2
                        [ class (join "onyx-sheet-title" h.titleClass)
                        , id (Maybe.withDefault (titleId h.scope) h.titleId)
                        ]
                        [ text h.title ]
                   ]
                ++ (case h.subtitle of
                        Just sub ->
                            [ p
                                (class "onyx-sheet-sub"
                                    :: (case h.subtitleId of
                                            Just sid ->
                                                [ id sid ]

                                            Nothing ->
                                                []
                                       )
                                )
                                [ text sub ]
                            ]

                        Nothing ->
                            []
                   )
            )
         ]
            ++ (if List.isEmpty h.actions then
                    []

                else
                    [ div [ class "onyx-sheet-head-actions" ] h.actions ]
               )
            ++ [ closeWith h.closeAttrs { label = h.closeLabel, onClose = h.onClose, testId = h.closeTestId, extraClass = h.closeClass } ]
        )


{-| An icon-only close button: the ✕ is a CSS mask (`.onyx-sheet-x`),
never a font glyph, and the accessible name is the label.
-}
closeButton : { label : String, onClose : msg, testId : Maybe String, extraClass : String } -> Html msg
closeButton c =
    closeWith [] c


closeWith : List (Html.Attribute msg) -> { label : String, onClose : msg, testId : Maybe String, extraClass : String } -> Html msg
closeWith extra c =
    button
        ([ type_ "button"
         , class (join "onyx-sheet-close" c.extraClass)
         , attribute "aria-label" c.label
         , onClick c.onClose
         ]
            ++ (case c.testId of
                    Just tid ->
                        [ attribute "data-testid" tid ]

                    Nothing ->
                        []
               )
            ++ extra
        )
        [ span [ class "onyx-sheet-x", attribute "aria-hidden" "true" ] [] ]


{-| Escape (outside IME composition) → the close message. -}
escapeDecoder : msg -> Decode.Decoder msg
escapeDecoder close =
    Decode.map2 Tuple.pair
        (Decode.field "key" Decode.string)
        (Decode.oneOf [ Decode.field "isComposing" Decode.bool, Decode.succeed False ])
        |> Decode.andThen
            (\( key, composing ) ->
                if key == "Escape" && not composing then
                    Decode.succeed close

                else
                    Decode.fail "not-escape"
            )


labelAttr : Label -> Html.Attribute msg
labelAttr label =
    case label of
        LabelledBy ref ->
            attribute "aria-labelledby" ref

        Labelled name ->
            attribute "aria-label" name


placementKey : Placement -> String
placementKey placement =
    case placement of
        Center ->
            "center"

        Side ->
            "side"

        Popover ->
            "popover"


boolString : Bool -> String
boolString b =
    if b then
        "true"

    else
        "false"


join : String -> String -> String
join base extra =
    if String.isEmpty extra then
        base

    else
        base ++ " " ++ extra
