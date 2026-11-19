-- Barberia AI — migração 0048: remove a versão antiga de create_manual_booking (8 parâmetros) que só existe no remoto.
-- APLICAR SOMENTE COM AUTORIZAÇÃO EXPLÍCITA. Depende da 0045. Testada em supabase/tests/reserva-manual-cota.test.ts.
-- Nenhum dado muda.
--
-- Encontrado ao conferir a aplicação da 0045 (2026-11-17): o remoto tem duas versões de create_manual_booking. A de 9 parâmetros
-- (0022, com p_email) recebeu a cota de 300 reservas manuais/24 h da 0045; a de 8 parâmetros é de uma versão anterior da 0022,
-- não está em nenhuma migration do repositório, segue executável por authenticated e não tem a cota. O app sempre chama a de
-- 9 parâmetros (src/features/booking/api.ts, createManualBooking) e nenhuma função de servidor ou fluxo do n8n usa a antiga.
-- Hoje NÃO é explorável: toda chamada com os 8 parâmetros também casa com a versão nova (p_email tem padrão) e o PostgreSQL
-- recusa por ambiguidade ('is not unique'). É limpeza preventiva: se a versão nova mudar de assinatura, a antiga, sem a cota,
-- passaria a responder. Em banco sem ela, este comando não faz nada.

drop function if exists public.create_manual_booking(uuid, uuid, uuid, timestamptz, text, text, boolean, text);
