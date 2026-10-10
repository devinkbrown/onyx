module View.Sheet exposing
    ( Config
    , Label(..)
    , Placement(..)
    , autofocus
    , closeButton
    , config
    , escapeDecoder
    , header
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

Existing sheets keep their own panel class (`panelClass`) so their
copy, test ids and per-sheet styling stay put; the layer, backdrop,
placement, elevation and entrance motion come from the shared
`.onyx-sheet*` rules in `app.css`.

-}

import Html exposing (Html, button, div, h2, section, span, text)
import Html.Attributes exposing (attribute, class, id, type_)
import Html.Events exposing (onClick, preventDefaultOn)
import Json.Decode as Decode


{-| Where the panel sits. `Center` is the default dialog; `Side` is a
right-hand drawer on desktop. Both become bottom sheets under 768px.
-}
type Placement
    = Center
    | Side


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
click, spec §2.9). Escape still sends `onClose`.
-}
viewPinned : Config msg -> List (Html msg) -> Html msg
viewPinned cfg body =
    render False cfg body


render : Bool -> Config msg -> List (Html msg) -> Html msg
render lightDismiss cfg body =
    div
        ([ class (join "onyx-sheet-layer" cfg.layerClass)
         , attribute "data-placement" (placementKey cfg.placement)
         ]
            ++ cfg.layerAttrs
        )
        [ div
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
             , preventDefaultOn "keydown" (Decode.map (\m -> ( m, True )) (escapeDecoder cfg.onClose))
             ]
                ++ cfg.attrs
            )
            body
        ]


{-| The standard head: a titled `h2` (id `titleId scope`) and a close
button. Sheets with bespoke heads keep theirs and use `closeButton`.
-}
header :
    { scope : String, title : String, closeLabel : String, onClose : msg, closeTestId : Maybe String }
    -> Html msg
header h =
    div [ class "onyx-sheet-head" ]
        [ h2 [ class "onyx-sheet-title", id (titleId h.scope) ] [ text h.title ]
        , closeButton { label = h.closeLabel, onClose = h.onClose, testId = h.closeTestId, extraClass = "" }
        ]


closeButton : { label : String, onClose : msg, testId : Maybe String, extraClass : String } -> Html msg
closeButton c =
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
        )
        [ span [ attribute "aria-hidden" "true" ] [ text "✕" ] ]


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


join : String -> String -> String
join base extra =
    if String.isEmpty extra then
        base

    else
        base ++ " " ++ extra
