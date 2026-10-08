module Provenance exposing
    ( Scope(..)
    , ariaLabel
    , descriptionFor
    , labelFor
    , scopeToString
    )

{-| Provenance badges, mirroring `src/lib/intelligence/provenance.ts`
(device / server / external scope labels marking where a computed
result came from).
-}


{-| Where a computed result ran: this browser, the connected server,
or an explicitly configured external endpoint. -}
type Scope
    = Device
    | Server
    | External


{-| Wire/class token for the scope (`data-scope` in the badge). -}
scopeToString : Scope -> String
scopeToString scope =
    case scope of
        Device ->
            "device"

        Server ->
            "server"

        External ->
            "external"


{-| Short badge text for the scope. -}
labelFor : Scope -> String
labelFor scope =
    case scope of
        Device ->
            "This device"

        Server ->
            "This server"

        External ->
            "External"


{-| Long badge description for the scope (badge `title`). -}
descriptionFor : Scope -> String
descriptionFor scope =
    case scope of
        Device ->
            "Computed locally in this browser from loaded or saved Onyx data."

        Server ->
            "Computed by the connected Onyx/Onyx Server server from server-side history."

        External ->
            "Computed by an explicitly configured external endpoint."


{-| Accessible badge description for a subject
(`subject provenance: <label>. <description>`). -}
ariaLabel : Scope -> String -> String
ariaLabel scope subject =
    subject ++ " provenance: " ++ labelFor scope ++ ". " ++ descriptionFor scope
