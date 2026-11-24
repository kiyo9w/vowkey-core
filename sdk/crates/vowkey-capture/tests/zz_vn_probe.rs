use vowkey_capture::matcher::{FormFieldInput, classify_form_fields};
#[test]
fn probe() {
    let labels = ["Đăng ký thành viên", "Họ và tên", "Ngày sinh (dd/mm/yyyy) dd/mm/yyyy", "Ngày sinh", "Email", "Quốc gia", "Tôi đông ý Gửi"];
    let fields: Vec<_> = labels.iter().map(|l| FormFieldInput { label: l.to_string(), input_type: "text".into(), ..FormFieldInput::default() }).collect();
    for (l, m) in labels.iter().zip(classify_form_fields(&fields, true)) { println!("{l} => {:?} section {}", m.attribute, m.section_id); }
}
