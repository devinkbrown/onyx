module View.KeyRecovery exposing (Props, view)

{-| Device recovery. Browser file handles and passphrase entry are owned by the
private runtime; no secret input is represented in Elm state or messages.
-}

import Html exposing (Html, button, div, h2, p, section, text)
import Html.Attributes exposing (class, disabled)
import Html.Events exposing (onClick)


type alias Props msg =
    { status : String
    , account : String
    , device : String
    , room : String
    , epoch : Maybe Int
    , busy : Bool
    , verifiedDevice : Bool
    , onEnroll : msg
    , onRequestWelcome : msg
    , onRotateRemovedDevice : msg
    , onExportBackup : msg
    , onImportBackup : msg
    }


view : Props msg -> Html msg
view props =
    section [ class "key-recovery", Html.Attributes.attribute "aria-label" "Device and room key recovery" ]
        [ h2 [] [ text "Device and room key recovery" ]
        , p [] [ text props.status ]
        , p [] [ text ("Account " ++ props.account ++ " · device " ++ props.device) ]
        , p [] [ text (props.room ++ (props.epoch |> Maybe.map (\value -> " · epoch " ++ String.fromInt value) |> Maybe.withDefault "")) ]
        , p [] [ text "A room-key backup cannot restore account credentials or device signing identity. A new device must enroll and receive a verified welcome." ]
        , div [ class "key-recovery-actions" ]
            [ button [ onClick props.onEnroll, disabled props.busy || props.verifiedDevice ] [ text "Enroll this device" ]
            , button [ onClick props.onRequestWelcome, disabled (props.busy || not props.verifiedDevice) ] [ text "Request a verified room welcome" ]
            , button [ onClick props.onRotateRemovedDevice, disabled (props.busy || not props.verifiedDevice) ] [ text "Rotate after device removal" ]
            , button [ onClick props.onExportBackup, disabled (props.busy || not props.verifiedDevice || props.epoch == Nothing) ] [ text "Export selected encrypted backup" ]
            , button [ onClick props.onImportBackup, disabled (props.busy || not props.verifiedDevice) ] [ text "Review and import encrypted backup" ]
            ]
        ]
